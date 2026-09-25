/**
 * Standalone player for exported HTML embeds: plain WebGL, no dependencies.
 *
 * This function is serialized with Function#toString() into the exported
 * file, so it must not reference anything outside its own body — shaders and
 * motion helpers are passed in through `lib`.
 */
export function particleRuntime(canvas, data, lib) {
  const { shaders, advancePointer, stepSprings, applyBurst, sheenPosition, spotlightColors, stepTilt } = lib;
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;

  const b64 = (s, Type) => {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Type(bytes.buffer);
  };
  const n = data.count;
  const cfg = data.cfg;
  const stage = data.stage;
  const q16 = b64(data.home, Int16Array);
  const home = new Float32Array(n * 3);
  const qs = b64(data.start, Int16Array);
  const start = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    home[i * 3] = q16[i * 2] / 16;
    home[i * 3 + 1] = q16[i * 2 + 1] / 16;
    start[i * 2] = qs[i * 2] / 16;
    start[i * 2 + 1] = qs[i * 2 + 1] / 16;
  }
  const u8 = (s, size) => {
    const src = b64(s, Uint8Array);
    const out = new Float32Array(n * size);
    for (let i = 0; i < out.length; i++) out[i] = src[i] / 255;
    return out;
  };
  const color = u8(data.color, 3);
  const scale = u8(data.scale, 1);
  const startScale = u8(data.startScale, 1);
  const delay = u8(data.delay, 1);
  const rand = u8(data.rand, 4);
  const offset = new Float32Array(n * 2);
  const vel = new Float32Array(n * 2);

  const VPRE = 'precision highp float;\nattribute vec3 position;\nattribute vec2 uv;\nuniform mat4 projectionMatrix;\nuniform mat4 modelViewMatrix;\n';
  const FPRE = 'precision highp float;\n';
  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VPRE + vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FPRE + fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const uniforms = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      uniforms[info.name] = { loc: gl.getUniformLocation(p, info.name), type: info.type };
    }
    return { p, uniforms };
  }
  const dots = program(shaders.particleVertex, shaders.dotFragment);
  const glow = program(shaders.particleVertex, shaders.glowFragment);
  const bg = program(shaders.backgroundVertex, shaders.backgroundFragment);

  function buffer(arr, usage) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, usage || gl.STATIC_DRAW);
    return buf;
  }
  const attrs = {
    position: [buffer(home), 3],
    aStart: [buffer(start), 2],
    aStartColor: [buffer(color), 3],
    aStartScale: [buffer(startScale), 1],
    aColor: [buffer(color), 3],
    aScale: [buffer(scale), 1],
    aDelay: [buffer(delay), 1],
    aRand: [buffer(rand), 4],
    aOffset: [buffer(offset, gl.DYNAMIC_DRAW), 2],
  };
  const quad = {
    position: [buffer(new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0])), 3],
    uv: [buffer(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0])), 2],
  };

  function bindAttrs(prog, set) {
    for (let i = 0; i < 16; i++) gl.disableVertexAttribArray(i);
    for (const name in set) {
      const loc = gl.getAttribLocation(prog.p, name);
      if (loc < 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, set[name][0]);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, set[name][1], gl.FLOAT, false, 0, 0);
    }
  }
  function setUniforms(prog, values) {
    for (const name in values) {
      const u = prog.uniforms[name];
      if (!u) continue;
      const v = values[name];
      if (u.type === gl.FLOAT) gl.uniform1f(u.loc, v);
      else if (u.type === gl.FLOAT_VEC2) gl.uniform2fv(u.loc, v);
      else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(u.loc, v);
      else if (u.type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(u.loc, false, v);
    }
  }

  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const intro = data.intro;
  const introEnd = intro.duration + intro.stagger;
  const sheenWidth = Math.max(stage.w, stage.h) * 0.06;
  const sheenDir = [0.8, -0.6];
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const base = cfg.background;
  const spot = spotlightColors(base);
  const pointer = { x: 1e5, y: 1e5, sx: 1e5, sy: 1e5, vx: 0, vy: 0, active: false, amt: 0 };
  const tilt = { x: 0, y: 0 };
  let W = 1, H = 1, pxPerUnit = 1, projection = identity;
  let time = 0, introTime = reduce ? 1e4 : 0, awake = false, playing = false, visible = true, frame = 0, last = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = Math.max(1, Math.round(canvas.clientWidth * dpr));
    H = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    pxPerUnit = Math.min(W / stage.w, H / stage.h);
    const hx = W / pxPerUnit / 2, hy = H / pxPerUnit / 2;
    projection = new Float32Array([1 / hx, 0, 0, 0, 0, 1 / hy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function toStage(e) {
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W, sy = ((e.clientY - r.top) / r.height) * H;
    return [(sx - W / 2) / pxPerUnit, -(sy - H / 2) / pxPerUnit];
  }
  canvas.addEventListener('pointermove', (e) => {
    const [x, y] = toStage(e);
    if (!pointer.active) { pointer.sx = x; pointer.sy = y; }
    pointer.x = x; pointer.y = y; pointer.active = true; awake = true;
  });
  canvas.addEventListener('pointerleave', () => { pointer.active = false; });
  canvas.addEventListener('pointercancel', () => { pointer.active = false; });
  canvas.addEventListener('pointerdown', (e) => {
    if (!cfg.clickBurst) return;
    const [x, y] = toStage(e);
    applyBurst(offset, vel, home, 3, n, x, y, cfg.repelRadius * 2.4, cfg.repelStrength * 3.2);
    awake = true;
  });

  function draw() {
    const moving = !reduce;
    const shared = {
      projectionMatrix: projection,
      modelViewMatrix: identity,
      uTime: time,
      uIntroTime: introTime,
      uDuration: intro.duration,
      uStagger: intro.stagger,
      uEase: intro.ease,
      uCurve: intro.curve,
      uFadeIn: intro.fadeIn,
      uPolar: intro.polar,
      uDotSize: cfg.dotSize,
      uPxPerUnit: pxPerUnit,
      uSizeVar: cfg.sizeVariance,
      uBrightVar: cfg.brightnessVariance,
      uIdle: moving ? cfg.idle : 0,
      uTwinkle: moving ? cfg.twinkle : 0,
      uOffsetMix: 1,
      uPointer: [pointer.sx, pointer.sy],
      uPointerAmt: pointer.amt,
      uLensRadius: cfg.repelRadius * 1.1,
      uLens: cfg.lens,
      uSheen: moving ? cfg.sheen : 0,
      uSheenPos: moving && cfg.sheen ? sheenPosition(data.bounds, sheenDir, sheenWidth, cfg.sheenInterval, introTime - introEnd) : 1e5,
      uSheenDir: sheenDir,
      uSheenWidth: sheenWidth,
      uSoftness: cfg.softness,
      uGlow: cfg.glow,
      uTilt: [tilt.x, tilt.y],
      uFocal: Math.max(stage.w, stage.h) * 1.6,
    };
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!data.transparent) {
      gl.disable(gl.BLEND);
      gl.useProgram(bg.p);
      bindAttrs(bg, quad);
      setUniforms(bg, {
        uColor: cfg.spotlight ? spot.edge : base,
        uColor2: spot.center,
        uSpot: cfg.spotlight ? 1 : 0,
        uAspect: W / H,
      });
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.enable(gl.BLEND);
    if (cfg.glow > 0 || (moving && cfg.sheen > 0)) {
      gl.useProgram(glow.p);
      bindAttrs(glow, attrs);
      setUniforms(glow, shared);
      setUniforms(glow, { uSizeMul: cfg.glowSize });
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, n);
    }
    gl.useProgram(dots.p);
    bindAttrs(dots, attrs);
    setUniforms(dots, shared);
    setUniforms(dots, { uSizeMul: 1 });
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, n);
  }

  function tick(now) {
    frame = 0;
    if (!visible) return;
    const dt = Math.min(0.05, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    if (playing) {
      time += dt;
      introTime += dt;
    }
    advancePointer(pointer, dt);
    stepTilt(tilt, pointer, stage, reduce ? 0 : cfg.tilt, dt);
    if (awake) {
      const energy = stepSprings(offset, vel, home, 3, n, pointer, cfg, dt);
      gl.bindBuffer(gl.ARRAY_BUFFER, attrs.aOffset[0]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, offset);
      if (!pointer.active && energy < 0.01 * Math.max(1, n / 1000)) {
        offset.fill(0);
        vel.fill(0);
        gl.bindBuffer(gl.ARRAY_BUFFER, attrs.aOffset[0]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, offset);
        awake = false;
      }
    }
    draw();
    frame = requestAnimationFrame(tick);
  }
  function wake() {
    if (!frame && visible) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  }

  resize();
  if ('ResizeObserver' in window) new ResizeObserver(() => { resize(); wake(); }).observe(canvas);
  else window.addEventListener('resize', resize);

  // Start the intro when the logo scrolls into view; pause while hidden.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !playing && entry.intersectionRatio >= 0.25) playing = true;
      wake();
    }, { threshold: [0, 0.25] }).observe(canvas);
  } else {
    playing = true;
  }
  wake();

  return {
    replay() {
      introTime = reduce ? 1e4 : 0;
      playing = true;
      wake();
    },
  };
}
