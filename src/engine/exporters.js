/**
 * Exports: high-resolution PNG stills, vector SVG and frame-accurate video.
 * Every export renders offscreen at a fixed timestep, so output is identical
 * regardless of display size or frame rate.
 */
import { rgbToHex } from './color';
import { mulberry32 } from './layouts';
import { spotlightColors } from './ParticleEngine';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportSize(stage, longEdge) {
  const s = longEdge / Math.max(stage.w, stage.h);
  // Even dimensions keep video encoders (4:2:0 chroma) happy.
  return {
    width: Math.round((stage.w * s) / 2) * 2,
    height: Math.round((stage.h * s) / 2) * 2,
  };
}

export async function exportPNG(engine, { longEdge = 3200, transparent = false } = {}) {
  const { width, height } = exportSize(engine.stage, longEdge);
  const off = engine.createOffscreen(width, height, { transparent });
  try {
    off.render(0, { still: true });
    return await new Promise((resolve, reject) =>
      off.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
  } finally {
    off.dispose();
  }
}

/** Vector export: one <circle> per particle, grouped by fill color. */
export function exportSVG(engine, { transparent = false } = {}) {
  const { layout, cfg, stage } = engine;
  const colors = engine.computeColors();
  const n = layout.count;
  const rng = mulberry32(cfg.seed + 17); // same stream the renderer uses
  const groups = new Map();
  const W = stage.w, H = stage.h;
  const f = (v) => +v.toFixed(2);

  for (let i = 0; i < n; i++) {
    rng(); rng();
    const rz = rng(), rw = rng();
    const size = cfg.dotSize * layout.scale[i] * (1 + (rw - 0.5) * 2 * cfg.sizeVariance);
    if (size <= 0.01) continue;
    const bright = 1 + (rz - 0.5) * 2 * cfg.brightnessVariance;
    const hex = rgbToHex([colors[i * 3] * bright, colors[i * 3 + 1] * bright, colors[i * 3 + 2] * bright]);
    const cx = f(layout.home[i * 2] + W / 2);
    const cy = f(H / 2 - layout.home[i * 2 + 1]);
    const circle = `<circle cx="${cx}" cy="${cy}" r="${f(size / 2)}"/>`;
    if (!groups.has(hex)) groups.set(hex, []);
    groups.get(hex).push(circle);
  }

  const defs = [];
  let background = '';
  if (!transparent) {
    if (cfg.spotlight) {
      const { center, edge } = spotlightColors(cfg.background);
      // Matches the shader: smoothstep falloff reaching the edge color at
      // 1.15 × half the longer side. Approximated with a few stops.
      const reach = (1.15 * Math.max(W, H)) / 2;
      const stops = [0, 0.25, 0.5, 0.75, 1]
        .map((t) => {
          const s = t * t * (3 - 2 * t);
          const col = rgbToHex(center.map((v, i) => v + (edge[i] - v) * s));
          return `<stop offset="${t}" stop-color="${col}"/>`;
        })
        .join('');
      defs.push(
        `<radialGradient id="spot" gradientUnits="userSpaceOnUse" cx="${W / 2}" cy="${H / 2}" r="${f(reach)}">${stops}</radialGradient>`,
      );
      background = `<rect width="${W}" height="${H}" fill="url(#spot)"/>`;
    } else {
      background = `<rect width="${W}" height="${H}" fill="${cfg.background}"/>`;
    }
  }
  let dotsAttrs = '';
  if (cfg.glow > 0) {
    const sigma = f(cfg.dotSize * cfg.glowSize * 0.18);
    defs.push(
      `<filter id="glow" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">` +
        `<feGaussianBlur in="SourceGraphic" stdDeviation="${sigma}" result="blur"/>` +
        `<feComponentTransfer in="blur" result="soft"><feFuncA type="linear" slope="${f(cfg.glow * 2.5)}"/></feComponentTransfer>` +
        `<feMerge><feMergeNode in="soft"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    );
    dotsAttrs = ' filter="url(#glow)"';
  }

  const body = [...groups.entries()]
    .map(([hex, circles]) => `<g fill="${hex}">${circles.join('')}</g>`)
    .join('\n');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">\n` +
    (defs.length ? `<defs>${defs.join('')}</defs>\n` : '') +
    (background ? background + '\n' : '') +
    `<g${dotsAttrs}>\n${body}\n</g>\n</svg>\n`
  );
}

/**
 * Frame-accurate video of the intro followed by `hold` seconds of idle
 * motion. Uses WebCodecs via mediabunny; MP4 (H.264) by default, WebM (VP9)
 * with an alpha channel when `transparent` is set.
 */
export async function exportVideo(
  engine,
  { longEdge = 1920, fps = 60, hold = 3, transparent = false, onProgress, signal } = {},
) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('Video export needs WebCodecs — use a recent Chrome, Edge or Safari.');
  }
  const mb = await import('mediabunny');
  const { width, height } = exportSize(engine.stage, longEdge);
  const webm = transparent;
  const codec = await mb.getFirstEncodableVideoCodec(webm ? ['vp9', 'av1', 'vp8'] : ['avc', 'hevc', 'vp9', 'av1'], {
    width,
    height,
  });
  if (!codec) throw new Error(`This browser cannot encode ${width}×${height} video.`);

  const off = engine.createOffscreen(width, height, { transparent, intro: engine.cfg.intro });
  const output = new mb.Output({
    format: webm ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new mb.BufferTarget(),
  });
  const source = new mb.CanvasSource(off.canvas, {
    codec,
    bitrate: mb.QUALITY_VERY_HIGH,
    alpha: transparent ? 'keep' : 'discard',
  });
  output.addVideoTrack(source, { frameRate: fps });

  try {
    await output.start();
    const duration = off.introEnd + hold;
    const frames = Math.ceil(duration * fps);
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / fps;
      off.render(t);
      await source.add(t, 1 / fps);
      onProgress?.((i + 1) / frames);
    }
    await output.finalize();
    return new Blob([output.target.buffer], { type: output.format.mimeType });
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {});
    throw err;
  } finally {
    off.dispose();
  }
}
