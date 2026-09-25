/**
 * ParticleEngine — framework-agnostic WebGL renderer for particle logos.
 *
 * Owns the three.js renderer, the particle buffers, the pointer physics and
 * the animation clock. React (or anything else) feeds it layouts + config.
 */
import * as THREE from 'three';
import {
  particleVertex,
  dotFragment,
  glowFragment,
  backgroundVertex,
  backgroundFragment,
} from './shaders';
import { hexToRgb, mixOklab } from './color';
import { mulberry32 } from './layouts';
import { advancePointer, stepSprings, applyBurst, sheenPosition, spotlightColors } from './motion';

/* ── Intro choreography ─────────────────────────────────────────────── */

const EASE = { expo: 0, quart: 1, inOutCubic: 2 };

export const INTRO_STYLES = {
  assemble: { name: 'Assemble', ease: EASE.expo, curve: 0.28, fadeIn: 1, polar: 0, duration: 1.7, stagger: 0.9 },
  vortex: { name: 'Vortex', ease: EASE.expo, curve: 0, fadeIn: 1, polar: 1, duration: 2.0, stagger: 0.8 },
  rise: { name: 'Rise', ease: EASE.expo, curve: 0, fadeIn: 1, polar: 0, duration: 1.2, stagger: 1.0 },
  bloom: { name: 'Bloom', ease: EASE.expo, curve: 0.08, fadeIn: 1, polar: 0, duration: 1.3, stagger: 0.8 },
  dissolve: { name: 'Dissolve', ease: EASE.quart, curve: 0, fadeIn: 1, polar: 0, duration: 1.0, stagger: 1.1 },
  none: { name: 'None', ease: EASE.quart, curve: 0, fadeIn: 0, polar: 0, duration: 0.001, stagger: 0 },
};

const MORPH = { ease: EASE.inOutCubic, curve: 0.18, fadeIn: 0, polar: 0, duration: 1.05, stagger: 0.4 };

function gaussian(rng) {
  const u = Math.max(1e-9, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function easeValue(mode, t) {
  if (mode === EASE.expo) return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  if (mode === EASE.quart) return 1 - Math.pow(1 - t, 4);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Per-style start positions, delays and start scales for an intro. */
function introAttributes(styleKey, layout, stage, seed) {
  const { count: n, home, bounds } = layout;
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const start = new Float32Array(n * 2);
  const startScale = new Float32Array(n);
  const delay = new Float32Array(n);
  const R = Math.max(stage.w, stage.h) / 2;
  const bw = Math.max(1e-3, bounds.maxX - bounds.minX);
  const maxR = Math.max(
    Math.hypot(bounds.minX, bounds.minY), Math.hypot(bounds.maxX, bounds.maxY),
    Math.hypot(bounds.minX, bounds.maxY), Math.hypot(bounds.maxX, bounds.minY), 1e-3,
  );

  for (let i = 0; i < n; i++) {
    const hx = home[i * 2], hy = home[i * 2 + 1];
    const r01 = Math.hypot(hx, hy) / maxR;
    switch (styleKey) {
      case 'vortex': {
        // Polar: x = radius multiplier, y = angular offset (radians).
        start[i * 2] = 2.1 + rng() * 0.9;
        start[i * 2 + 1] = 2.2 + rng() * 1.4 + (1 - r01) * 1.2;
        startScale[i] = 0.35;
        delay[i] = r01 * 0.6 + rng() * 0.4;
        break;
      }
      case 'rise': {
        start[i * 2] = hx;
        start[i * 2 + 1] = hy - stage.h * 0.06 - rng() * stage.h * 0.03;
        startScale[i] = 0.2;
        delay[i] = ((hx - bounds.minX) / bw) * 0.8 + rng() * 0.2;
        break;
      }
      case 'bloom': {
        start[i * 2] = hx * 0.12 + gaussian(rng) * 6;
        start[i * 2 + 1] = hy * 0.12 + gaussian(rng) * 6;
        startScale[i] = 0;
        delay[i] = r01 * 0.85 + rng() * 0.15;
        break;
      }
      case 'dissolve': {
        start[i * 2] = hx + gaussian(rng) * 14;
        start[i * 2 + 1] = hy + gaussian(rng) * 14;
        startScale[i] = 0;
        delay[i] = rng();
        break;
      }
      case 'none': {
        start[i * 2] = hx;
        start[i * 2 + 1] = hy;
        startScale[i] = -1; // resolved to the final scale below
        delay[i] = 0;
        break;
      }
      case 'assemble':
      default: {
        // A wide, loose cloud spatially correlated with the final shape, so
        // the logo appears to condense rather than fly in from noise.
        const spread = 1.7 + rng() * 0.8;
        start[i * 2] = hx * spread + gaussian(rng) * R * 0.22;
        start[i * 2 + 1] = hy * spread + gaussian(rng) * R * 0.22;
        startScale[i] = 0.5;
        delay[i] = rng();
      }
    }
  }
  return { start, startScale, delay };
}

/* ── Materials ──────────────────────────────────────────────────────── */

function createUniforms() {
  return {
    uTime: { value: 0 },
    uIntroTime: { value: 1e4 },
    uDuration: { value: 1 },
    uStagger: { value: 0 },
    uEase: { value: 0 },
    uCurve: { value: 0 },
    uFadeIn: { value: 0 },
    uPolar: { value: 0 },
    uDotSize: { value: 3 },
    uPxPerUnit: { value: 1 },
    uSizeVar: { value: 0 },
    uBrightVar: { value: 0 },
    uIdle: { value: 0 },
    uTwinkle: { value: 0 },
    uSizeMul: { value: 1 },
    uOffsetMix: { value: 1 },
    uPointer: { value: new THREE.Vector2(1e5, 1e5) },
    uPointerAmt: { value: 0 },
    uLensRadius: { value: 100 },
    uLens: { value: 0 },
    uSheen: { value: 0 },
    uSheenPos: { value: 1e5 },
    uSheenDir: { value: new THREE.Vector2(0.8, -0.6) },
    uSheenWidth: { value: 60 },
    uSoftness: { value: 0 },
    uGlow: { value: 0 },
  };
}

function createMaterials() {
  const uniforms = createUniforms();
  const dots = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: dotFragment,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: true,
  });
  const glow = new THREE.ShaderMaterial({
    vertexShader: particleVertex,
    fragmentShader: glowFragment,
    // Share every uniform except the size multiplier.
    uniforms: { ...uniforms, uSizeMul: { value: 4 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const background = new THREE.ShaderMaterial({
    vertexShader: backgroundVertex,
    fragmentShader: backgroundFragment,
    uniforms: {
      uColor: { value: new THREE.Vector3(0.04, 0.04, 0.04) },
      uColor2: { value: new THREE.Vector3(0.08, 0.08, 0.09) },
      uSpot: { value: 0 },
      uAspect: { value: 1 },
    },
    depthTest: false,
    depthWrite: false,
  });
  return { uniforms, dots, glow, background };
}

/** A self-contained scene: background quad + glow pass + dot pass. */
class ParticleScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    this.materials = createMaterials();
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.materials.background);
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -1;
    this.scene.add(this.bg);
    this.geometry = null;
    this.points = null;
    this.glowPoints = null;
  }

  setStage(w, h) {
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
    this.materials.background.uniforms.uAspect.value = w / h;
  }

  setGeometry(geometry) {
    if (this.points) {
      this.scene.remove(this.points, this.glowPoints);
      this.geometry.dispose();
    }
    this.geometry = geometry;
    this.glowPoints = new THREE.Points(geometry, this.materials.glow);
    this.glowPoints.frustumCulled = false;
    this.glowPoints.renderOrder = 0;
    this.glowPoints.visible = this.materials.uniforms.uGlow.value > 0 || this.materials.uniforms.uSheen.value > 0;
    this.points = new THREE.Points(geometry, this.materials.dots);
    this.points.frustumCulled = false;
    this.points.renderOrder = 1;
    this.scene.add(this.glowPoints, this.points);
  }

  dispose() {
    this.geometry?.dispose();
    this.bg.geometry.dispose();
    Object.values(this.materials).forEach((m) => m.dispose?.());
  }
}

function buildGeometry(n) {
  const g = new THREE.BufferGeometry();
  const attr = (name, size) => {
    const a = new THREE.BufferAttribute(new Float32Array(n * size), size);
    g.setAttribute(name, a);
    return a.array;
  };
  return {
    geometry: g,
    position: attr('position', 3),
    start: attr('aStart', 2),
    startColor: attr('aStartColor', 3),
    startScale: attr('aStartScale', 1),
    color: attr('aColor', 3),
    scale: attr('aScale', 1),
    delay: attr('aDelay', 1),
    rand: attr('aRand', 4),
    offset: attr('aOffset', 2),
  };
}

/* ── Engine ─────────────────────────────────────────────────────────── */

export class ParticleEngine {
  constructor(canvas, { onStats } = {}) {
    this.canvas = canvas;
    this.onStats = onStats;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // dots are analytically anti-aliased in the shader
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.view = new ParticleScene();
    this.stage = { w: 800, h: 800 };
    this.view.setStage(800, 800);
    this.cfg = null;
    this.layout = null;
    this.buffers = null;
    this.count = 0;
    this.primary = null; // particles that remain after a morph settles

    this.time = 0;
    this.introTime = 1e4;
    this.transition = INTRO_STYLES.none;
    this.transitionEnd = 0;
    this.pointer = { x: 1e5, y: 1e5, sx: 1e5, sy: 1e5, vx: 0, vy: 0, active: false, amt: 0 };
    this.awake = false;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* Geometry of the stage, in abstract units. */
  setStage(w, h) {
    this.stage = { w, h };
    this.view.setStage(w, h);
  }

  setViewport(cssW, cssH, dpr) {
    this.dpr = dpr;
    this.cssW = cssW;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.view.materials.uniforms.uPxPerUnit.value = (cssW * dpr) / this.stage.w;
  }

  setConfig(cfg) {
    const prev = this.cfg;
    this.cfg = cfg;
    applyUniforms(this.view, cfg, this.stage);
    const colorKeys = ['colorMode', 'color', 'gradientFrom', 'gradientTo', 'gradientAngle'];
    if (this.layout && (!prev || colorKeys.some((k) => prev[k] !== cfg[k]))) {
      this.recolor();
    }
  }

  /** Target colors for the current layout under the current color mode. */
  computeColors(layout = this.layout, cfg = this.cfg) {
    return particleColors(layout, cfg);
  }

  recolor() {
    const b = this.buffers;
    if (!b) return;
    const colors = this.computeColors();
    for (let i = 0; i < this.count; i++) {
      const src = this.primary[i];
      b.color[i * 3] = colors[src * 3];
      b.color[i * 3 + 1] = colors[src * 3 + 1];
      b.color[i * 3 + 2] = colors[src * 3 + 2];
    }
    // Snap start colors too so a mid-intro color change doesn't fade from stale values.
    if (this.transition.fadeIn) b.startColor.set(b.color);
    this.buffers.geometry.attributes.aColor.needsUpdate = true;
    this.buffers.geometry.attributes.aStartColor.needsUpdate = true;
  }

  /**
   * Swap in a new layout. `mode`: 'intro' plays the configured intro,
   * 'morph' flows the current particles into the new shape.
   */
  setLayout(layout, mode = 'intro') {
    const canMorph = mode === 'morph' && this.buffers && this.count > 0 && !this.reducedMotion;
    const colors = this.computeColors(layout);
    if (canMorph) this.morphTo(layout, colors);
    else this.introduce(layout, colors, mode === 'none' || this.reducedMotion ? 'none' : this.cfg.intro);
    this.layout = layout;
    const avg = [0, 0, 0];
    for (let i = 0; i < layout.count; i++) for (let c = 0; c < 3; c++) avg[c] += layout.color[i * 3 + c];
    this.onStats?.({ count: layout.count, avgColor: avg.map((v) => v / Math.max(1, layout.count)) });
  }

  replay() {
    if (!this.layout) return;
    this.introduce(this.layout, this.computeColors(), this.reducedMotion ? 'none' : this.cfg.intro);
  }

  introduce(layout, colors, styleKey) {
    const { buffers, style } = bakeIntro(layout, colors, styleKey, this.stage, this.cfg.seed);
    this.install(buffers, layout.count, Uint32Array.from({ length: layout.count }, (_, i) => i));
    this.beginTransition(style, this.cfg.introSpeed);
  }

  /** Geometry + timing for playing `intro` on the current layout (used by exports). */
  bake(intro) {
    const { buffers, style } = bakeIntro(this.layout, this.computeColors(), intro || 'none', this.stage, this.cfg.seed);
    const sp = Math.max(0.1, this.cfg.introSpeed);
    return {
      buffers,
      style,
      duration: style.duration / sp,
      stagger: style.stagger / sp,
      end: intro ? (style.duration + style.stagger) / sp : 0,
    };
  }

  morphTo(layout, colors) {
    const old = this.snapshot();
    const n = layout.count;
    if (!old.count) {
      this.introduce(layout, colors, this.cfg.intro);
      return;
    }

    // Correspondence by nearest neighbor after normalizing both shapes to a
    // common frame (centered, uniformly scaled). The map is continuous, so
    // regions flow into regions without seams. Every new particle starts at
    // its nearest old particle; old particles nobody picked become ghosts
    // that merge into their nearest new particle and shrink away.
    const oldN = normalizePoints(old.pos, old.count);
    const newN = normalizePoints(layout.home, n);
    const nearestOld = nearestIndexer(oldN, old.count);
    const nearestNew = nearestIndexer(newN, n);
    const source = new Uint32Array(n);
    const used = new Uint8Array(old.count);
    for (let i = 0; i < n; i++) {
      const o = nearestOld(newN[i * 2], newN[i * 2 + 1]);
      source[i] = o;
      used[o] = 1;
    }
    const ghosts = [];
    for (let o = 0; o < old.count; o++) if (!used[o]) ghosts.push(o);

    const N = n + ghosts.length;
    const b = buildGeometry(N);
    const rng = mulberry32(this.cfg.seed + 101);
    const primary = new Uint32Array(N);
    const seen = new Uint16Array(old.count);
    const gap = this.cfg.gap;

    const write = (q, ni, oi, isGhost) => {
      primary[q] = ni;
      b.position[q * 3] = layout.home[ni * 2];
      b.position[q * 3 + 1] = layout.home[ni * 2 + 1];
      b.scale[q] = isGhost ? 0 : layout.scale[ni];
      for (let c = 0; c < 3; c++) {
        b.color[q * 3 + c] = colors[ni * 3 + c];
        b.startColor[q * 3 + c] = old.color[oi * 3 + c];
      }
      // When several particles split off one source, only the first keeps its
      // size; the rest emerge small from a little cloud around it, so splits
      // never start as a bright stacked blob.
      const k = isGhost ? 0 : seen[oi]++;
      const spread = k ? gap * 0.6 * Math.sqrt(k) : 0;
      const a = rng() * Math.PI * 2;
      b.start[q * 2] = old.pos[oi * 2] + Math.cos(a) * spread;
      b.start[q * 2 + 1] = old.pos[oi * 2 + 1] + Math.sin(a) * spread;
      b.startScale[q] = k ? old.scale[oi] * 0.2 : old.scale[oi];
      b.delay[q] = rng();
    };
    for (let i = 0; i < n; i++) write(i, i, source[i], false);
    ghosts.forEach((o, k) => write(n + k, nearestNew(oldN[o * 2], oldN[o * 2 + 1]), o, true));

    fillRandom(b.rand, N, this.cfg.seed);
    this.install(b, N, primary);
    this.pendingCompact = ghosts.length ? layout : null;
    this.beginTransition(MORPH, 1);
  }

  /** Current on-screen state of every visible particle (CPU mirror of the shader). */
  snapshot() {
    const b = this.buffers;
    const u = this.view.materials.uniforms;
    const tr = this.transition;
    const n = this.count;
    const pos = new Float32Array(n * 2);
    const scale = new Float32Array(n);
    const color = new Float32Array(n * 3);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const t = Math.min(1, Math.max(0, (this.introTime - b.delay[i] * u.uStagger.value) / u.uDuration.value));
      const e = easeValue(tr.ease, t);
      const s = b.startScale[i] + (b.scale[i] - b.startScale[i]) * e;
      if (s < 0.05) continue; // skip invisible ghosts
      const hx = b.position[i * 3], hy = b.position[i * 3 + 1];
      let x, y;
      if (tr.polar) {
        const m = b.start[i * 2] + (1 - b.start[i * 2]) * e;
        const a = b.start[i * 2 + 1] * (1 - e);
        x = (hx * Math.cos(a) - hy * Math.sin(a)) * m;
        y = (hx * Math.sin(a) + hy * Math.cos(a)) * m;
      } else {
        const sx = b.start[i * 2], sy = b.start[i * 2 + 1];
        const dx = hx - sx, dy = hy - sy;
        const bow = (b.rand[i * 4 + 1] - 0.5) * tr.curve * Math.sin(Math.PI * e);
        x = sx + dx * e - dy * bow;
        y = sy + dy * e + dx * bow;
      }
      pos[k * 2] = x + b.offset[i * 2];
      pos[k * 2 + 1] = y + b.offset[i * 2 + 1];
      scale[k] = s;
      for (let c = 0; c < 3; c++) color[k * 3 + c] = b.startColor[i * 3 + c] + (b.color[i * 3 + c] - b.startColor[i * 3 + c]) * e;
      k++;
    }
    return { count: k, pos, scale, color };
  }

  install(buffers, count, primary) {
    this.buffers = buffers;
    this.count = count;
    this.primary = primary;
    this.vel = new Float32Array(count * 2);
    this.view.setGeometry(buffers.geometry);
  }

  beginTransition(style, speed = 1) {
    const u = this.view.materials.uniforms;
    const sp = Math.max(0.1, speed);
    this.transition = style;
    this.introTime = 0;
    u.uDuration.value = style.duration / sp;
    u.uStagger.value = style.stagger / sp;
    u.uEase.value = style.ease;
    u.uCurve.value = style.curve;
    u.uFadeIn.value = style.fadeIn;
    u.uPolar.value = style.polar;
    this.transitionEnd = (style.duration + style.stagger) / sp;
  }

  /** Drop morph ghosts once they've fully merged. */
  compact() {
    const layout = this.pendingCompact;
    this.pendingCompact = null;
    const n = layout.count;
    const b = buildGeometry(n);
    fillStatic(b, layout, this.computeColors(layout), this.cfg.seed);
    b.start.set(Array.from({ length: n * 2 }, (_, i) => layout.home[i]));
    b.startScale.set(b.scale);
    b.startColor.set(b.color);
    // Carry pointer offsets across so nothing jumps.
    const old = this.buffers, oldVel = this.vel;
    const vel = new Float32Array(n * 2);
    for (let q = 0; q < this.count; q++) {
      if (old.scale[q] === 0) continue;
      const i = this.primary[q];
      b.offset[i * 2] = old.offset[q * 2];
      b.offset[i * 2 + 1] = old.offset[q * 2 + 1];
      vel[i * 2] = oldVel[q * 2];
      vel[i * 2 + 1] = oldVel[q * 2 + 1];
    }
    this.install(b, n, Uint32Array.from({ length: n }, (_, i) => i));
    this.vel = vel;
    this.transition = INTRO_STYLES.none;
    this.introTime = 1e4;
  }

  /* ── Pointer ───────────────────────────────────────────────────────── */

  pointerMove(x, y) {
    const p = this.pointer;
    if (!p.active) { p.sx = x; p.sy = y; }
    p.x = x;
    p.y = y;
    p.active = true;
    this.awake = true;
  }

  pointerLeave() {
    this.pointer.active = false;
  }

  /** Radial impulse, e.g. on click. */
  burst(x, y) {
    if (!this.buffers || !this.cfg) return;
    const b = this.buffers;
    applyBurst(b.offset, this.vel, b.position, 3, this.count, x, y, this.cfg.repelRadius * 2.4, this.cfg.repelStrength * 3.2);
    this.awake = true;
  }

  /* ── Frame loop ────────────────────────────────────────────────────── */

  tick = (now) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (!this.cfg || !this.buffers) {
      this.renderer.render(this.view.scene, this.view.camera);
      return;
    }
    this.time += dt;
    this.introTime += dt;
    if (this.pendingCompact && this.introTime > this.transitionEnd + 0.05) this.compact();

    advancePointer(this.pointer, dt);
    if (this.awake) this.stepPhysics(dt);

    const u = this.view.materials.uniforms;
    u.uTime.value = this.time;
    u.uIntroTime.value = this.introTime;
    u.uPointer.value.set(this.pointer.sx, this.pointer.sy);
    u.uPointerAmt.value = this.pointer.amt;
    updateSheen(u, this.cfg, this.layout, this.introTime - this.transitionEnd);
    this.renderer.render(this.view.scene, this.view.camera);
  };

  stepPhysics(dt) {
    const b = this.buffers;
    const energy = stepSprings(b.offset, this.vel, b.position, 3, this.count, this.pointer, this.cfg, dt);
    b.geometry.attributes.aOffset.needsUpdate = true;
    if (!this.pointer.active && energy < 0.01 * Math.max(1, this.count / 1000)) {
      b.offset.fill(0);
      this.vel.fill(0);
      this.awake = false;
    }
  }

  /* ── Export helpers ────────────────────────────────────────────────── */

  /**
   * Builds an offscreen renderer + scene showing the current layout. The
   * returned object can render any intro time, for stills or video frames.
   */
  createOffscreen(width, height, { transparent = false, intro = null } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.setClearColor(0x000000, 0);

    const view = new ParticleScene();
    view.setStage(this.stage.w, this.stage.h);
    const layout = this.layout;
    const baked = this.bake(intro);
    view.setGeometry(baked.buffers.geometry);

    applyUniforms(view, { ...this.cfg, transparent }, this.stage);
    const u = view.materials.uniforms;
    u.uPxPerUnit.value = width / this.stage.w;
    u.uOffsetMix.value = 0;
    u.uPointerAmt.value = 0;
    u.uDuration.value = baked.duration;
    u.uStagger.value = baked.stagger;
    u.uEase.value = baked.style.ease;
    u.uCurve.value = baked.style.curve;
    u.uFadeIn.value = baked.style.fadeIn;
    u.uPolar.value = baked.style.polar;
    const introEnd = baked.end;

    return {
      canvas,
      introEnd,
      /**
       * Render at clock time `t`. `introTime` (defaults to `t`) positions the
       * intro timeline separately, which lets a video play it in reverse.
       */
      render: (t, { still = false, introTime = t } = {}) => {
        u.uIntroTime.value = intro ? introTime : 1e4;
        u.uTime.value = t;
        if (still) {
          u.uIdle.value = 0;
          u.uTwinkle.value = 0;
          u.uSheen.value = 0;
        } else {
          updateSheen(u, this.cfg, layout, introTime < t ? -1 : t - introEnd);
        }
        renderer.render(view.scene, view.camera);
      },
      dispose: () => {
        view.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      },
    };
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.view.dispose();
    this.renderer.dispose();
  }
}

/* ── Shared helpers ─────────────────────────────────────────────────── */

/** Center on the bounding box and scale uniformly so the larger side is 1. */
function normalizePoints(pts, n) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], y = pts[i * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const s = 1 / Math.max(1e-6, maxX - minX, maxY - minY);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = (pts[i * 2] - cx) * s;
    out[i * 2 + 1] = (pts[i * 2 + 1] - cy) * s;
  }
  return out;
}

/** Grid-accelerated nearest-neighbor lookup over normalized points. */
function nearestIndexer(pts, n) {
  const res = Math.max(4, Math.ceil(Math.sqrt(n) / 2));
  const cell = 1.02 / res;
  const head = new Int32Array(res * res).fill(-1);
  const next = new Int32Array(n);
  const cellOf = (v) => Math.max(0, Math.min(res - 1, Math.floor((v + 0.51) / cell)));
  for (let i = 0; i < n; i++) {
    const c = cellOf(pts[i * 2 + 1]) * res + cellOf(pts[i * 2]);
    next[i] = head[c];
    head[c] = i;
  }
  return (x, y) => {
    const cx = cellOf(x), cy = cellOf(y);
    let best = 0, bestD = Infinity;
    for (let ring = 0; ring < res; ring++) {
      for (let j = cy - ring; j <= cy + ring; j++) {
        if (j < 0 || j >= res) continue;
        for (let i = cx - ring; i <= cx + ring; i++) {
          if (i < 0 || i >= res) continue;
          if (ring > 0 && j !== cy - ring && j !== cy + ring && i !== cx - ring && i !== cx + ring) continue;
          for (let k = head[j * res + i]; k >= 0; k = next[k]) {
            const dx = pts[k * 2] - x, dy = pts[k * 2 + 1] - y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = k; }
          }
        }
      }
      // Anything outside this ring is at least `ring * cell` away.
      if (bestD < (ring * cell) * (ring * cell)) break;
    }
    return best;
  };
}

/** Buffers for a layout about to play an intro style. */
function bakeIntro(layout, colors, styleKey, stage, seed) {
  const n = layout.count;
  const b = buildGeometry(n);
  fillStatic(b, layout, colors, seed);
  const style = INTRO_STYLES[styleKey] || INTRO_STYLES.assemble;
  const intro = introAttributes(styleKey, layout, stage, seed);
  b.start.set(intro.start);
  b.delay.set(intro.delay);
  for (let i = 0; i < n; i++) {
    b.startScale[i] = intro.startScale[i] < 0 ? b.scale[i] : intro.startScale[i] * b.scale[i];
  }
  b.startColor.set(b.color);
  return { buffers: b, style };
}

function fillRandom(rand, n, seed) {
  const rng = mulberry32(seed + 17);
  for (let i = 0; i < n * 4; i++) rand[i] = rng();
}

function fillStatic(b, layout, colors, seed) {
  const n = layout.count;
  for (let i = 0; i < n; i++) {
    b.position[i * 3] = layout.home[i * 2];
    b.position[i * 3 + 1] = layout.home[i * 2 + 1];
    b.start[i * 2] = layout.home[i * 2];
    b.start[i * 2 + 1] = layout.home[i * 2 + 1];
    b.scale[i] = layout.scale[i];
  }
  b.color.set(colors);
  fillRandom(b.rand, n, seed);
}

export function particleColors(layout, cfg) {
  const n = layout.count;
  const out = new Float32Array(n * 3);
  if (cfg.colorMode === 'solid') {
    const c = hexToRgb(cfg.color);
    for (let i = 0; i < n; i++) out.set(c, i * 3);
  } else if (cfg.colorMode === 'gradient') {
    const a = hexToRgb(cfg.gradientFrom), b = hexToRgb(cfg.gradientTo);
    const ang = (cfg.gradientAngle * Math.PI) / 180;
    const dx = Math.cos(ang), dy = -Math.sin(ang);
    const { minX, minY, maxX, maxY } = layout.bounds;
    const corners = [[minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]].map(([x, y]) => x * dx + y * dy);
    const lo = Math.min(...corners), hi = Math.max(...corners);
    // Precompute a small LUT — OKLab mixing per particle is needlessly slow.
    const lut = Array.from({ length: 256 }, (_, i) => mixOklab(a, b, i / 255));
    for (let i = 0; i < n; i++) {
      const t = (layout.home[i * 2] * dx + layout.home[i * 2 + 1] * dy - lo) / Math.max(1e-6, hi - lo);
      out.set(lut[Math.max(0, Math.min(255, Math.round(t * 255)))], i * 3);
    }
  } else {
    out.set(layout.color);
  }
  return out;
}

function applyUniforms(view, cfg, stage) {
  const u = view.materials.uniforms;
  u.uDotSize.value = cfg.dotSize;
  u.uSizeVar.value = cfg.sizeVariance;
  u.uBrightVar.value = cfg.brightnessVariance;
  u.uSoftness.value = cfg.softness;
  u.uIdle.value = cfg.idle;
  u.uTwinkle.value = cfg.twinkle;
  u.uLensRadius.value = cfg.repelRadius * 1.1;
  u.uLens.value = cfg.lens;
  u.uSheen.value = cfg.sheen;
  u.uSheenWidth.value = Math.max(stage.w, stage.h) * 0.06;
  u.uGlow.value = cfg.glow;
  view.materials.glow.uniforms.uSizeMul.value = cfg.glowSize;
  if (view.glowPoints) view.glowPoints.visible = cfg.glow > 0 || cfg.sheen > 0;

  const bg = view.materials.background.uniforms;
  const base = hexToRgb(cfg.background);
  const { edge, center } = spotlightColors(base);
  bg.uColor.value.set(...(cfg.spotlight ? edge : base));
  bg.uColor2.value.set(...center);
  bg.uSpot.value = cfg.spotlight ? 1 : 0;
  view.bg.visible = !cfg.transparent;
}

function updateSheen(u, cfg, layout, sinceIntro) {
  u.uSheenPos.value = cfg.sheen && layout
    ? sheenPosition(layout.bounds, [u.uSheenDir.value.x, u.uSheenDir.value.y], u.uSheenWidth.value, cfg.sheenInterval, sinceIntro)
    : 1e5;
}
