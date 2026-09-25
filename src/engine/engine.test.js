import { describe, it, expect } from 'vitest';
import { traceContours, resampleContours } from './contours';
import { organicLayout, latticeLayout, ditherLayout } from './layouts';
import { segmentRegions } from './regions';
import { hexToRgb, rgbToHex, mixOklab, contrastRatio } from './color';
import { stepSprings, sheenPosition } from './motion';

/**
 * Synthetic field in the same shape rasterizeSvg() produces. `paint(x, y)`
 * receives stage coordinates (origin at center, y up) plus the pixel size,
 * and returns [coverage, r, g, b].
 */
function makeField(stageW, stageH, ss, paint) {
  const W = stageW * ss, H = stageH * ss;
  const alpha = new Float32Array(W * H);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5) / ss - stageW / 2;
      const y = stageH / 2 - (py + 0.5) / ss;
      const [a, r, g, b] = paint(x, y, 1 / ss);
      const i = py * W + px;
      alpha[i] = a;
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = b;
      rgba[i * 4 + 3] = Math.round(a * 255);
    }
  }
  return { width: W, height: H, ss, stageW, stageH, alpha, rgba };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const disc = (R, color = [255, 255, 255]) => (x, y, px) => [clamp01((R - Math.hypot(x, y)) / px + 0.5), ...color];
const square = (half, color = [255, 255, 255]) => (x, y, px) => [
  clamp01((half - Math.abs(x)) / px + 0.5) * clamp01((half - Math.abs(y)) / px + 0.5),
  ...color,
];

function polygonArea(loop) {
  let a = 0;
  const n = loop.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += loop[i * 2] * loop[j * 2 + 1] - loop[j * 2] * loop[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}

function minPairDistance(home, n) {
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(home[i * 2] - home[j * 2], home[i * 2 + 1] - home[j * 2 + 1]);
      if (d < best) best = d;
    }
  }
  return best;
}

describe('contours', () => {
  it('traces a disc as one closed loop with the right area', () => {
    const f = makeField(120, 120, 2, disc(40));
    const loops = traceContours(f.alpha, f.width, f.height);
    expect(loops).toHaveLength(1);
    const areaUnits = polygonArea(loops[0]) / (f.ss * f.ss);
    expect(areaUnits).toBeCloseTo(Math.PI * 40 * 40, -1.5);
    expect(Math.abs(areaUnits / (Math.PI * 1600) - 1)).toBeLessThan(0.01);
  });

  it('traces holes as separate loops', () => {
    const ring = (x, y, px) => {
      const d = Math.hypot(x, y);
      return [clamp01((40 - d) / px + 0.5) * clamp01((d - 20) / px + 0.5), 255, 255, 255];
    };
    const f = makeField(120, 120, 2, ring);
    expect(traceContours(f.alpha, f.width, f.height)).toHaveLength(2);
  });

  it('resamples evenly and pins sharp corners', () => {
    const f = makeField(120, 120, 2, square(40));
    const loops = traceContours(f.alpha, f.width, f.height);
    const spacing = 12;
    const { points } = resampleContours(loops, spacing);
    const n = points.length / 2;
    // Perimeter 4 × 160 px → about 53 samples.
    expect(n).toBeGreaterThan(48);
    expect(n).toBeLessThan(58);
    // Every corner of the square has a sample right on it.
    const c = f.width / 2, h = 40 * f.ss;
    for (const [cx, cy] of [[c - h, c - h], [c + h, c - h], [c - h, c + h], [c + h, c + h]]) {
      let best = Infinity;
      for (let i = 0; i < n; i++) best = Math.min(best, Math.hypot(points[i * 2] - cx, points[i * 2 + 1] - cy));
      expect(best).toBeLessThan(1.5);
    }
  });
});

describe('organic layout', () => {
  const field = () => makeField(160, 160, 2, disc(60));

  it('keeps particles apart and inside the shape', () => {
    const gap = 6;
    const l = organicLayout(field(), { gap, edgeInset: 0.3, seed: 3 });
    expect(minPairDistance(l.home, l.count)).toBeGreaterThan(gap * 0.6);
    for (let i = 0; i < l.count; i++) {
      expect(Math.hypot(l.home[i * 2], l.home[i * 2 + 1])).toBeLessThan(60);
    }
    // Density close to an even packing of the disc.
    const hexCount = (Math.PI * 60 * 60) / (gap * gap * Math.sqrt(3) / 2);
    expect(l.count / hexCount).toBeGreaterThan(0.75);
    expect(l.count / hexCount).toBeLessThan(1.1);
  });

  it('lines the outline with an evenly inset row', () => {
    const gap = 6, inset = 0.3;
    const l = organicLayout(field(), { gap, edgeInset: inset, seed: 3 });
    const edgeRadii = [];
    for (let i = 0; i < l.count; i++) if (l.edge[i]) edgeRadii.push(Math.hypot(l.home[i * 2], l.home[i * 2 + 1]));
    expect(edgeRadii.length).toBeGreaterThan((2 * Math.PI * 60) / gap * 0.9);
    for (const r of edgeRadii) expect(Math.abs(r - (60 - gap * inset))).toBeLessThan(0.5);
  });

  it('is deterministic for a given seed', () => {
    const a = organicLayout(field(), { gap: 6, seed: 11 });
    const b = organicLayout(field(), { gap: 6, seed: 11 });
    expect(a.count).toBe(b.count);
    expect(Array.from(a.home)).toEqual(Array.from(b.home));
  });
});

describe('lattice layouts', () => {
  it('fills a disc like a hex lattice and shrinks edge dots', () => {
    const gap = 5;
    const l = latticeLayout(makeField(160, 160, 2, disc(60)), { gap, shape: 'hex' });
    // Dots with ≥10% coverage extend the disc by ~0.4 spacing.
    const expected = (Math.PI * Math.pow(60 + 0.4 * gap, 2)) / (gap * gap * Math.sqrt(3) / 2);
    expect(Math.abs(l.count / expected - 1)).toBeLessThan(0.04);
    const partial = Array.from(l.scale).filter((s) => s < 1).length;
    expect(partial).toBeGreaterThan(20);
  });

  it('dithers in linear light: sRGB 188 (50% luminance) → half density', () => {
    const gap = 4;
    const f = makeField(120, 120, 2, square(50, [188, 188, 188]));
    const l = ditherLayout(f, { gap, threshold: 0.5 });
    const cells = Math.pow(100 / gap, 2);
    expect(l.count / cells).toBeGreaterThan(0.45);
    expect(l.count / cells).toBeLessThan(0.55);
  });

  it('keeps hue at full value when density carries brightness', () => {
    const f = makeField(120, 120, 2, square(50, [128, 0, 0]));
    const l = ditherLayout(f, { gap: 4, toneSource: 'value' });
    expect(l.color[0]).toBeCloseTo(1, 2);
    expect(l.color[1]).toBeCloseTo(0, 2);
    const cells = Math.pow(100 / 4, 2);
    // sRGB 128 → 21.6% linear.
    expect(Math.abs(l.count / cells - 0.216)).toBeLessThan(0.04);
  });
});

describe('color regions', () => {
  it('splits hard color edges into regions', () => {
    const twoTone = (x, y, px) => [clamp01((50 - Math.max(Math.abs(x), Math.abs(y))) / px + 0.5), ...(x < 0 ? [229, 9, 20] : [255, 255, 255])];
    const r = segmentRegions(makeField(120, 120, 2, twoTone));
    expect(r?.count).toBe(2);
  });

  it('keeps gradients and single colors whole', () => {
    const gradient = (x, y, px) => {
      const t = (x + 50) / 100;
      return [clamp01((50 - Math.max(Math.abs(x), Math.abs(y))) / px + 0.5), 244 - t * 210, 114 + t * 97, 182 + t * 56];
    };
    expect(segmentRegions(makeField(120, 120, 2, gradient))).toBeNull();
    expect(segmentRegions(makeField(120, 120, 2, square(50, [94, 106, 210])))).toBeNull();
  });
});

describe('color', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#5e6ad2'))).toBe('#5e6ad2');
    expect(hexToRgb('#fff')).toEqual([1, 1, 1]);
  });

  it('mixes in OKLab with exact endpoints', () => {
    const a = [1, 0, 0], b = [0, 0, 1];
    mixOklab(a, b, 0).forEach((v, i) => expect(v).toBeCloseTo(a[i], 4));
    mixOklab(a, b, 1).forEach((v, i) => expect(v).toBeCloseTo(b[i], 4));
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio([1, 1, 1], [0, 0, 0])).toBeCloseTo(21, 5);
  });
});

describe('motion', () => {
  it('springs settle back home', () => {
    const n = 3;
    const home = new Float32Array(n * 3);
    const off = Float32Array.from([10, 0, -5, 5, 0, 8]);
    const vel = new Float32Array(n * 2);
    const pointer = { sx: 1e5, sy: 1e5, vx: 0, vy: 0, active: false, amt: 0 };
    const cfg = { damping: 0.84, spring: 0.055, repelRadius: 90, repelStrength: 4, swirl: 0, drag: 0 };
    const first = stepSprings(off, vel, home, 3, n, pointer, cfg, 1 / 60);
    let energy = first;
    for (let i = 0; i < 240; i++) energy = stepSprings(off, vel, home, 3, n, pointer, cfg, 1 / 60);
    expect(energy).toBeLessThan(first * 0.01);
  });

  it('runs the sheen in periodic sweeps after the intro', () => {
    const bounds = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
    const dir = [0.8, -0.6];
    expect(sheenPosition(bounds, dir, 40, 4, 0.2)).toBe(1e5);
    const a = sheenPosition(bounds, dir, 40, 4, 1);
    const b = sheenPosition(bounds, dir, 40, 4, 2);
    expect(b).toBeGreaterThan(a);
    expect(sheenPosition(bounds, dir, 40, 4, 0.4 + 2.2 + 1)).toBe(1e5);
  });
});
