import { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shaders';
import { DITHER_ALGORITHMS } from './dithering';

/**
 * Sample pixel data from an SVG string rendered to a hidden canvas.
 */
function getPixelData(svgString, width, height) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = new Image();
    const encoded = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

    img.onload = () => {
      try {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        resolve(imageData.data);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('SVG load failed'));
    img.src = encoded;
  });
}

export default function ParticleLogo({
  svgString,
  width = 400,
  height = 400,
  config,
  onParticleCount,
}) {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: 9999, y: 9999, active: false });
  const frameRef = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let disposed = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true });
    } catch {
      setStatus('error');
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(new THREE.Color(config.bgColor), 1);

    const scene = new THREE.Scene();
    const hw = width / 2, hh = height / 2;
    const camera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 100);
    camera.position.z = 10;
    renderer.render(scene, camera);

    async function init() {
      let data;
      try {
        const px = await getPixelData(svgString, width, height);
        const algo = DITHER_ALGORITHMS[config.ditherAlgorithm];
        if (algo.hasFS) {
          data = algo.fn(px, width, height, config.gap, {
            threshold: config.fsThreshold,
            gamma: config.fsGamma,
            errorStrength: config.fsErrorStrength,
            serpentine: config.fsSerpentine,
            invert: config.fsInvert,
            particleColor: config.fsParticleColor,
          });
        } else if (algo.hasIntensity) {
          data = algo.fn(px, width, height, config.gap, config.ditherIntensity);
        } else {
          data = algo.fn(px, width, height, config.gap);
        }
      } catch (e) {
        console.error('Sampling failed:', e);
        setStatus('error');
        return;
      }

      if (disposed || !data.count) {
        setStatus('error');
        return;
      }

      const { positions: home, colors: homeColors, count } = data;
      onParticleCount?.(count);

      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      const vel = new Float32Array(count * 3);
      const sizes = new Float32Array(count);

      // Random scatter for entrance animation
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 250 + Math.random() * 200;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = Math.sin(a) * r;
        pos[i * 3 + 2] = 0;
        sizes[i] = Math.random();
      }

      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(homeColors), 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

      const dpr = Math.min(window.devicePixelRatio, 2);
      const mat = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uPointSize: { value: config.particleSize * dpr },
          uSizeVariance: { value: config.sizeVariance },
          uSoftness: { value: config.softness },
        },
      });

      const points = new THREE.Points(geo, mat);
      scene.add(points);
      setStatus('ready');

      const posAttr = geo.attributes.position;

      function animate() {
        if (disposed) return;
        frameRef.current = requestAnimationFrame(animate);

        // Update uniforms in case config changed (they're refs)
        mat.uniforms.uPointSize.value = config.particleSize * dpr;
        mat.uniforms.uSizeVariance.value = config.sizeVariance;
        mat.uniforms.uSoftness.value = config.softness;
        renderer.setClearColor(new THREE.Color(config.bgColor), 1);

        const m = mouseRef.current;
        const a = posAttr.array;
        const spring = config.spring;
        const damping = config.damping;
        const repelRadius = config.repelRadius;
        const repelStrength = config.repelStrength;

        for (let i = 0; i < count; i++) {
          const ix = i * 3, iy = i * 3 + 1;
          let vx = vel[ix], vy = vel[iy];

          // Spring to home
          vx += (home[ix] - a[ix]) * spring;
          vy += (home[iy] - a[iy]) * spring;

          // Mouse repulsion
          if (m.active) {
            const dx = a[ix] - m.x, dy = a[iy] - m.y;
            const d2 = dx * dx + dy * dy;
            const rr = repelRadius * repelRadius;
            if (d2 < rr && d2 > 1) {
              const d = Math.sqrt(d2);
              const f = repelStrength * (1 - d / repelRadius);
              vx += (dx / d) * f;
              vy += (dy / d) * f;
            }
          }

          // Damping
          vx *= damping;
          vy *= damping;

          // Integrate
          a[ix] += vx;
          a[iy] += vy;
          vel[ix] = vx;
          vel[iy] = vy;
        }

        posAttr.needsUpdate = true;
        renderer.render(scene, camera);
      }

      animate();
    }

    init();

    return () => {
      disposed = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      renderer.dispose();
    };
  }, [svgString, width, height, config.gap, config.ditherAlgorithm, config.ditherIntensity, config.bgColor, config.fsThreshold, config.fsGamma, config.fsErrorStrength, config.fsSerpentine, config.fsInvert]);
  // Only re-init on structural changes. Physics/visual params update live via refs in animate loop.

  const onMove = useCallback((e) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    mouseRef.current = {
      x: e.clientX - r.left - width / 2,
      y: -(e.clientY - r.top - height / 2),
      active: true,
    };
  }, [width, height]);

  const onLeave = useCallback(() => {
    mouseRef.current.active = false;
  }, []);

  const onTouch = useCallback((e) => {
    const t = e.touches[0];
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r || !t) return;
    mouseRef.current = {
      x: t.clientX - r.left - width / 2,
      y: -(t.clientY - r.top - height / 2),
      active: true,
    };
  }, [width, height]);

  return (
    <div className="canvas-wrapper">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onTouchMove={onTouch}
        onTouchEnd={onLeave}
        style={{ width, height }}
      />
      {status === 'loading' && <div className="canvas-loading">sampling...</div>}
      {status === 'error' && <div className="canvas-loading">failed to load SVG</div>}
    </div>
  );
}
