/**
 * Dithering algorithms for particle sampling from SVG pixel data.
 * Each returns { positions: Float32Array, colors: Float32Array, count: number }
 */

// ── Hex Grid + Jitter (default) ──
// Staggered hex rows with per-particle random offset. Best general-purpose.
export function hexGridJitter(px, width, height, gap, jitterAmount = 0.2) {
  const positions = [], colors = [];
  const rowH = gap * 0.866; // sqrt(3)/2
  const jitter = gap * jitterAmount;
  let row = 0;

  for (let y = gap / 2; y < height; y += rowH) {
    const offset = (row % 2) * (gap / 2);
    for (let x = gap / 2 + offset; x < width; x += gap) {
      const sx = Math.round(x), sy = Math.round(y);
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const i = (sy * width + sx) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
      if (a < 80 || (r < 25 && g < 25 && b < 25)) continue;

      const jx = x + (Math.random() - 0.5) * jitter;
      const jy = y + (Math.random() - 0.5) * jitter;
      positions.push(jx - width / 2, -(jy - height / 2), 0);
      colors.push(r / 255, g / 255, b / 255);
    }
    row++;
  }
  return pack(positions, colors);
}

// ── Uniform Grid (no dithering) ──
// Strict square grid — shows banding clearly (useful as a baseline).
export function uniformGrid(px, width, height, gap) {
  const positions = [], colors = [];

  for (let y = gap / 2; y < height; y += gap) {
    for (let x = gap / 2; x < width; x += gap) {
      const sx = Math.round(x), sy = Math.round(y);
      if (sx >= width || sy >= height) continue;
      const i = (sy * width + sx) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
      if (a < 80 || (r < 25 && g < 25 && b < 25)) continue;

      positions.push(x - width / 2, -(y - height / 2), 0);
      colors.push(r / 255, g / 255, b / 255);
    }
  }
  return pack(positions, colors);
}

// ── Blue Noise (Poisson Disk approximation) ──
// Mitchell's Best Candidate — produces well-distributed points with no visible grid.
export function blueNoise(px, width, height, gap) {
  const minDist = gap * 0.85;
  const candidates = 30;
  const maxPoints = Math.ceil((width * height) / (gap * gap)) * 2;
  const positions = [], colors = [];
  const placed = [];

  for (let attempt = 0; attempt < maxPoints; attempt++) {
    let bestX = 0, bestY = 0, bestDist = 0;

    for (let c = 0; c < candidates; c++) {
      const cx = Math.random() * width;
      const cy = Math.random() * height;

      let nearestDist = Infinity;
      for (const p of placed) {
        const dx = cx - p[0], dy = cy - p[1];
        nearestDist = Math.min(nearestDist, dx * dx + dy * dy);
      }

      if (nearestDist > bestDist) {
        bestDist = nearestDist;
        bestX = cx;
        bestY = cy;
      }
    }

    if (placed.length > 0 && Math.sqrt(bestDist) < minDist * 0.5) continue;

    const sx = Math.round(bestX), sy = Math.round(bestY);
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
    const i = (sy * width + sx) * 4;
    const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
    if (a < 80 || (r < 25 && g < 25 && b < 25)) continue;

    placed.push([bestX, bestY]);
    positions.push(bestX - width / 2, -(bestY - height / 2), 0);
    colors.push(r / 255, g / 255, b / 255);
  }
  return pack(positions, colors);
}

// ── Halton Sequence (quasi-random, low-discrepancy) ──
// Deterministic, evenly-spaced sampling using base-2 and base-3 Halton sequences.
export function haltonSequence(px, width, height, gap) {
  const positions = [], colors = [];
  const maxSamples = Math.ceil((width * height) / (gap * gap)) * 3;

  function halton(index, base) {
    let result = 0, f = 1;
    let i = index;
    while (i > 0) {
      f /= base;
      result += f * (i % base);
      i = Math.floor(i / base);
    }
    return result;
  }

  const minDist2 = (gap * 0.6) * (gap * 0.6);
  const placed = [];

  for (let n = 1; n < maxSamples; n++) {
    const x = halton(n, 2) * width;
    const y = halton(n, 3) * height;

    // Check minimum spacing
    let tooClose = false;
    for (const p of placed) {
      const dx = x - p[0], dy = y - p[1];
      if (dx * dx + dy * dy < minDist2) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const sx = Math.round(x), sy = Math.round(y);
    if (sx >= width || sy >= height) continue;
    const i = (sy * width + sx) * 4;
    const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
    if (a < 80 || (r < 25 && g < 25 && b < 25)) continue;

    placed.push([x, y]);
    positions.push(x - width / 2, -(y - height / 2), 0);
    colors.push(r / 255, g / 255, b / 255);
  }
  return pack(positions, colors);
}

// ── Ordered (Bayer) Dithering ──
// Uses a 4x4 Bayer matrix to create a structured but less visibly banded pattern.
export function bayerDither(px, width, height, gap, intensity = 0.5) {
  const positions = [], colors = [];
  // 4x4 Bayer matrix normalized to [0,1]
  const bayer = [
    [0/16, 8/16, 2/16, 10/16],
    [12/16, 4/16, 14/16, 6/16],
    [3/16, 11/16, 1/16, 9/16],
    [15/16, 7/16, 13/16, 5/16],
  ];

  const rowH = gap * 0.866;
  let row = 0;

  for (let y = gap / 2; y < height; y += rowH) {
    const offset = (row % 2) * (gap / 2);
    for (let x = gap / 2 + offset; x < width; x += gap) {
      const bx = Math.floor(x / gap) % 4;
      const by = Math.floor(y / gap) % 4;
      const threshold = bayer[by][bx];

      // Offset position based on Bayer threshold
      const ox = (threshold - 0.5) * gap * intensity;
      const oy = (bayer[(by + 2) % 4][(bx + 2) % 4] - 0.5) * gap * intensity;

      const sx = Math.round(x), sy = Math.round(y);
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const i = (sy * width + sx) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
      if (a < 80 || (r < 25 && g < 25 && b < 25)) continue;

      positions.push((x + ox) - width / 2, -((y + oy) - height / 2), 0);
      colors.push(r / 255, g / 255, b / 255);
    }
    row++;
  }
  return pack(positions, colors);
}

// ── Helper ──
function pack(positions, colors) {
  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 3,
  };
}

// ── Algorithm registry ──
export const DITHER_ALGORITHMS = {
  'hex-jitter': { name: 'Hex Grid + Jitter', fn: hexGridJitter, hasIntensity: true },
  'uniform': { name: 'Uniform Grid', fn: uniformGrid, hasIntensity: false },
  'blue-noise': { name: 'Blue Noise', fn: blueNoise, hasIntensity: false },
  'halton': { name: 'Halton Sequence', fn: haltonSequence, hasIntensity: false },
  'bayer': { name: 'Bayer (Ordered)', fn: bayerDither, hasIntensity: true },
};
