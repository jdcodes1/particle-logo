/**
 * Particle layouts. Each takes a rasterized field (see rasterize.js) and
 * returns particle home positions in stage units (origin at center, y up),
 * source colors and a per-particle size scale.
 */
import { traceContours, resampleContours, sampleField } from './contours';

/** Small, fast, seedable PRNG so layouts are identical on every run. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Alpha-weighted average color around a raster point. */
function sampleColor(field, x, y, radius) {
  const { width: w, height: h, alpha, rgba } = field;
  const rad = Math.max(1, Math.min(4, Math.round(radius)));
  const cx = Math.round(x - 0.5), cy = Math.round(y - 0.5);
  let r = 0, g = 0, b = 0, wsum = 0;
  for (let dy = -rad; dy <= rad; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= h) continue;
    for (let dx = -rad; dx <= rad; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= w) continue;
      const i = yy * w + xx;
      // Weight by coverage squared: fully covered pixels carry the true color.
      const a = alpha[i];
      const wt = a * a;
      if (wt < 1e-4) continue;
      r += rgba[i * 4] * wt;
      g += rgba[i * 4 + 1] * wt;
      b += rgba[i * 4 + 2] * wt;
      wsum += wt;
    }
  }
  if (wsum === 0) return [1, 1, 1];
  return [r / wsum / 255, g / wsum / 255, b / wsum / 255];
}

function luminance(field, i) {
  const p = i * 4;
  return (0.2126 * field.rgba[p] + 0.7152 * field.rgba[p + 1] + 0.0722 * field.rgba[p + 2]) / 255;
}

/** Summed-area table for O(1) box averages. */
function summedArea(values, w, h) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += values[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  return (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.min(w, Math.round(x0)));
    x1 = Math.max(0, Math.min(w, Math.round(x1)));
    y0 = Math.max(0, Math.min(h, Math.round(y0)));
    y1 = Math.max(0, Math.min(h, Math.round(y1)));
    const area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return 0;
    const W = w + 1;
    return (sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0]) / area;
  };
}

function finalize(field, raw) {
  const n = raw.length;
  const home = new Float32Array(n * 2);
  const color = new Float32Array(n * 3);
  const scale = new Float32Array(n);
  const edge = new Uint8Array(n);
  const { ss, stageW, stageH } = field;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = raw[i];
    const x = p.x / ss - stageW / 2;
    const y = stageH / 2 - p.y / ss;
    home[i * 2] = x;
    home[i * 2 + 1] = y;
    const c = p.color || sampleColor(field, p.x, p.y, p.colorRadius ?? ss);
    color[i * 3] = c[0];
    color[i * 3 + 1] = c[1];
    color[i * 3 + 2] = c[2];
    scale[i] = p.scale ?? 1;
    edge[i] = p.edge ? 1 : 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    count: n,
    home,
    color,
    scale,
    edge,
    bounds: n ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  };
}

/**
 * Organic: evenly spaced particles traced along every contour (so edges stay
 * crisp) and a blue-noise (Poisson disk) fill for the interior.
 */
export function organicLayout(field, { gap, edgeInset = 0.35, seed = 7, relaxIterations = 14 }) {
  const { width: W, height: H, ss, alpha } = field;
  const r = gap * ss;
  const rng = mulberry32(seed);
  const at = (x, y) => sampleField(alpha, W, H, x, y);

  // Spatial hash sized so each cell holds at most one point.
  const seedDist = r * 0.72;
  const cell = seedDist / Math.SQRT2;
  const gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1;
  const grid = new Int32Array(gw * gh).fill(-1);
  const xs = [], ys = [], edgeFlags = [];

  const fits = (x, y, minD) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    const reach = Math.ceil(minD / cell);
    const m2 = minD * minD;
    for (let j = Math.max(0, gy - reach); j <= Math.min(gh - 1, gy + reach); j++) {
      for (let i = Math.max(0, gx - reach); i <= Math.min(gw - 1, gx + reach); i++) {
        const k = grid[j * gw + i];
        if (k < 0) continue;
        const dx = xs[k] - x, dy = ys[k] - y;
        if (dx * dx + dy * dy < m2) return false;
      }
    }
    return true;
  };
  const insert = (x, y, isEdge) => {
    const gi = Math.floor(y / cell) * gw + Math.floor(x / cell);
    if (grid[gi] >= 0) return -1;
    const k = xs.length;
    xs.push(x);
    ys.push(y);
    edgeFlags.push(isEdge);
    grid[gi] = k;
    return k;
  };

  // 1. Contour particles, inset along the coverage gradient.
  // Contours only depend on the field, so they're traced once and reused
  // while spacing or inset sliders move.
  const loops = field.contours || (field.contours = traceContours(alpha, W, H, 0.5));
  const { points, singles } = resampleContours(loops, r);
  const inset = gap * edgeInset * ss;
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1];
    const gx = at(x + 1, y) - at(x - 1, y);
    const gy = at(x, y + 1) - at(x, y - 1);
    const len = Math.hypot(gx, gy);
    if (len < 1e-5) continue;
    const nx = gx / len, ny = gy / len;
    let px = x + nx * inset, py = y + ny * inset;
    if (at(px, py) < 0.5) {
      // Thin feature: fall back to a shallower inset.
      px = x + nx * inset * 0.4;
      py = y + ny * inset * 0.4;
      if (at(px, py) < 0.5) continue;
    }
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    if (fits(px, py, seedDist)) insert(px, py, true);
  }
  for (const [x, y] of singles) {
    if (at(x, y) >= 0.5 && fits(x, y, seedDist)) insert(x, y, true);
  }

  // 2. Poisson-disk interior fill, grown from the contour seeds.
  //    Candidates sit exactly on the r-circle (Roberts' variant of Bridson),
  //    which packs more tightly and evenly than the classic annulus.
  const active = xs.map((_, i) => i);
  // Shapes too small to produce contour points still get a start point.
  if (active.length === 0) {
    for (let y = 0; y < H && active.length === 0; y += r) {
      for (let x = 0; x < W; x += r) {
        if (at(x, y) >= 0.5) { active.push(insert(x, y, false)); break; }
      }
    }
  }
  const K = 24;
  const eps = 1e-4;
  while (active.length) {
    const ai = Math.floor(rng() * active.length);
    const k = active[ai];
    const ox = xs[k], oy = ys[k];
    const base = rng();
    let found = false;
    for (let j = 0; j < K; j++) {
      const theta = 2 * Math.PI * (base + j / K);
      const rad = r + eps;
      const cx = ox + Math.cos(theta) * rad;
      const cy = oy + Math.sin(theta) * rad;
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
      if (at(cx, cy) < 0.5) continue;
      if (!fits(cx, cy, r)) continue;
      const idx = insert(cx, cy, false);
      if (idx < 0) continue;
      active.push(idx);
      found = true;
      break;
    }
    if (!found) {
      active[ai] = active[active.length - 1];
      active.pop();
    }
  }

  // 3. Relax the interior: short-range repulsion evens out the irregular
  //    gaps Poisson sampling leaves behind, giving a calm, uniform texture
  //    that still reads as organic. Contour particles stay pinned.
  relax(xs, ys, edgeFlags, r, at, relaxIterations);

  const raw = xs.map((x, i) => ({ x, y: ys[i], edge: edgeFlags[i], colorRadius: Math.min(2, r * 0.3) }));
  return finalize(field, raw);
}

function relax(xs, ys, pinned, r, inside, iterations) {
  const n = xs.length;
  if (!iterations || n < 3) return;
  const R = r * 1.45;
  const cell = R;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  const gw = Math.ceil((maxX - minX) / cell) + 3;
  const gh = Math.ceil((maxY - minY) / cell) + 3;
  const head = new Int32Array(gw * gh);
  const next = new Int32Array(n);
  const nx = new Float64Array(n), ny = new Float64Array(n);

  for (let it = 0; it < iterations; it++) {
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      const c = (Math.floor((ys[i] - minY) / cell) + 1) * gw + Math.floor((xs[i] - minX) / cell) + 1;
      next[i] = head[c];
      head[c] = i;
    }
    const strength = 0.5 * (1 - it / (iterations + 1));
    for (let i = 0; i < n; i++) {
      nx[i] = xs[i];
      ny[i] = ys[i];
      if (pinned[i]) continue;
      const x = xs[i], y = ys[i];
      const cx = Math.floor((x - minX) / cell) + 1, cy = Math.floor((y - minY) / cell) + 1;
      let fx = 0, fy = 0;
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (let k = cx - 1; k <= cx + 1; k++) {
          for (let o = head[j * gw + k]; o >= 0; o = next[o]) {
            if (o === i) continue;
            const dx = x - xs[o], dy = y - ys[o];
            const d2 = dx * dx + dy * dy;
            if (d2 >= R * R || d2 < 1e-9) continue;
            const d = Math.sqrt(d2);
            const push = (R - d) / R;
            fx += (dx / d) * push * push;
            fy += (dy / d) * push * push;
          }
        }
      }
      let sx = fx * r * strength, sy = fy * r * strength;
      const len = Math.hypot(sx, sy);
      const cap = r * 0.25;
      if (len > cap) { sx *= cap / len; sy *= cap / len; }
      if (inside(x + sx, y + sy) >= 0.5) { nx[i] = x + sx; ny[i] = y + sy; }
      else if (inside(x + sx * 0.4, y + sy * 0.4) >= 0.5) { nx[i] = x + sx * 0.4; ny[i] = y + sy * 0.4; }
    }
    for (let i = 0; i < n; i++) { xs[i] = nx[i]; ys[i] = ny[i]; }
  }
}

/**
 * Lattice layouts. `grid` scales edge particles by coverage (anti-aliased
 * halftone edges); `halftone` sizes every particle by tone (coverage × luma).
 */
export function latticeLayout(field, { gap, shape = 'hex', mode = 'coverage', angle = 0, minCoverage = 0.1, gamma = 1 }) {
  const { width: W, height: H, ss, alpha, stageW, stageH } = field;
  const values = new Float32Array(W * H);
  if (mode === 'tone') {
    for (let i = 0; i < values.length; i++) {
      values[i] = alpha[i] > 0 ? alpha[i] * Math.pow(luminance(field, i), 1 / gamma) : 0;
    }
  } else {
    values.set(alpha);
  }
  const box = summedArea(values, W, H);

  const rowH = shape === 'hex' ? gap * Math.sqrt(3) / 2 : gap;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const extent = Math.hypot(stageW, stageH) / 2;
  const rows = Math.ceil(extent / rowH);
  const cols = Math.ceil(extent / gap) + 1;
  const half = (gap * ss) / 2;
  const raw = [];

  for (let j = -rows; j <= rows; j++) {
    const shift = shape === 'hex' && (j & 1) ? gap / 2 : 0;
    for (let i = -cols; i <= cols; i++) {
      const lx = i * gap + shift, ly = j * rowH;
      const x = lx * cos - ly * sin;
      const y = lx * sin + ly * cos;
      const X = (x + stageW / 2) * ss;
      const Y = (stageH / 2 - y) * ss;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const cov = box(X - half, Y - half, X + half, Y + half);
      if (cov < minCoverage) continue;
      raw.push({
        x: X,
        y: Y,
        scale: cov > 0.97 ? 1 : Math.sqrt(cov),
        edge: cov < 0.97,
        colorRadius: Math.min(3, half),
      });
    }
  }
  return finalize(field, raw);
}

/**
 * Floyd–Steinberg error diffusion on a square lattice. Tone is coverage ×
 * luminance, so flat colors resolve into evenly dithered densities.
 */
export function ditherLayout(field, { gap, threshold = 0.5, gamma = 1, errorStrength = 1, serpentine = true, invert = false }) {
  const { width: W, height: H, ss, alpha, stageW, stageH } = field;
  const values = new Float32Array(W * H);
  for (let i = 0; i < values.length; i++) {
    const a = alpha[i];
    if (a <= 0) continue;
    const l = luminance(field, i);
    values[i] = a * (invert ? 1 - l : l);
  }
  const box = summedArea(values, W, H);
  const cover = summedArea(alpha, W, H);

  // Lattice centered on the stage so symmetric logos dither symmetrically.
  const cols = Math.floor(stageW / gap), rows = Math.floor(stageH / gap);
  const ox = (stageW - (cols - 1) * gap) / 2, oy = (stageH - (rows - 1) * gap) / 2;
  const half = (gap * ss) / 2;
  const tone = new Float32Array(cols * rows);
  const covered = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const X = (ox + i * gap) * ss, Y = (oy + j * gap) * ss;
      const c = cover(X - half, Y - half, X + half, Y + half);
      if (c < 0.04) continue;
      covered[j * cols + i] = 1;
      tone[j * cols + i] = Math.pow(Math.min(1, box(X - half, Y - half, X + half, Y + half)), 1 / gamma);
    }
  }

  const raw = [];
  for (let j = 0; j < rows; j++) {
    const ltr = !serpentine || j % 2 === 0;
    for (let s = 0; s < cols; s++) {
      const i = ltr ? s : cols - 1 - s;
      const idx = j * cols + i;
      const old = tone[idx];
      const on = old >= threshold ? 1 : 0;
      const err = (old - on) * errorStrength;
      const dir = ltr ? 1 : -1;
      const push = (di, dj, w) => {
        const ii = i + di * dir, jj = j + dj;
        if (ii < 0 || ii >= cols || jj >= rows) return;
        const t = jj * cols + ii;
        if (covered[t]) tone[t] += err * w;
      };
      push(1, 0, 7 / 16);
      push(-1, 1, 3 / 16);
      push(0, 1, 5 / 16);
      push(1, 1, 1 / 16);
      if (on && covered[idx]) {
        raw.push({ x: (ox + i * gap) * ss, y: (oy + j * gap) * ss, colorRadius: Math.min(3, half) });
      }
    }
  }
  return finalize(field, raw);
}

export const LAYOUTS = {
  organic: { name: 'Organic', description: 'Traced edges with a blue-noise fill' },
  grid: { name: 'Grid', description: 'Dot-matrix lattice with anti-aliased edges' },
  halftone: { name: 'Halftone', description: 'Dot size follows tone' },
  dither: { name: 'Dither', description: 'Floyd–Steinberg error diffusion' },
};

export function buildLayout(field, cfg) {
  switch (cfg.layout) {
    case 'grid':
      return latticeLayout(field, { gap: cfg.gap, shape: cfg.gridShape, mode: 'coverage' });
    case 'halftone':
      return latticeLayout(field, {
        gap: cfg.gap,
        shape: cfg.gridShape,
        mode: 'tone',
        angle: cfg.gridShape === 'square' ? 45 : 0,
        minCoverage: 0.04,
        gamma: cfg.toneGamma,
      });
    case 'dither':
      return ditherLayout(field, {
        gap: cfg.gap,
        threshold: cfg.ditherThreshold,
        gamma: cfg.toneGamma,
        invert: cfg.ditherInvert,
      });
    case 'organic':
    default:
      return organicLayout(field, { gap: cfg.gap, edgeInset: cfg.edgeInset, seed: cfg.seed });
  }
}
