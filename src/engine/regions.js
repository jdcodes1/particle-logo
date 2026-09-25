/**
 * Color regions for multi-color logos.
 *
 * Flat brand marks often have hard internal color edges (a white glyph on a
 * colored tile, two-tone ribbons). Those edges deserve the same crisp,
 * traced outline as the silhouette. Gradients, on the other hand, must not be
 * cut into bands. So: cluster colors with k-means, then merge clusters whose
 * shared boundary changes smoothly — what's left are regions separated by
 * genuine hard edges.
 */
import { mulberry32 } from './random';

const MIN_ALPHA = 0.9;

function kmeans(samples, k, rng, iterations = 12) {
  const m = samples.length / 3;
  const centers = new Float32Array(k * 3);
  // k-means++ seeding.
  const first = Math.floor(rng() * m);
  centers.set(samples.subarray(first * 3, first * 3 + 3), 0);
  const dist = new Float32Array(m).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < m; i++) {
      const dr = samples[i * 3] - centers[(c - 1) * 3];
      const dg = samples[i * 3 + 1] - centers[(c - 1) * 3 + 1];
      const db = samples[i * 3 + 2] - centers[(c - 1) * 3 + 2];
      dist[i] = Math.min(dist[i], dr * dr + dg * dg + db * db);
      total += dist[i];
    }
    let pick = rng() * total, idx = 0;
    for (; idx < m - 1 && pick > dist[idx]; idx++) pick -= dist[idx];
    centers.set(samples.subarray(idx * 3, idx * 3 + 3), c * 3);
  }
  const sums = new Float64Array(k * 3);
  const counts = new Uint32Array(k);
  for (let it = 0; it < iterations; it++) {
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < m; i++) {
      const c = nearest(centers, k, samples[i * 3], samples[i * 3 + 1], samples[i * 3 + 2]);
      sums[c * 3] += samples[i * 3];
      sums[c * 3 + 1] += samples[i * 3 + 1];
      sums[c * 3 + 2] += samples[i * 3 + 2];
      counts[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (!counts[c]) continue;
      for (let j = 0; j < 3; j++) centers[c * 3 + j] = sums[c * 3 + j] / counts[c];
    }
  }
  return { centers, counts };
}

function nearest(centers, k, r, g, b) {
  let best = 0, bestD = Infinity;
  for (let c = 0; c < k; c++) {
    const dr = r - centers[c * 3], dg = g - centers[c * 3 + 1], db = b - centers[c * 3 + 2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/**
 * Returns null for single-region logos, otherwise
 * { count, regionMap: Uint8Array (255 = empty), mask(r): Float32Array }.
 */
export function segmentRegions(field, { maxClusters = 8, seed = 1 } = {}) {
  const { width: W, height: H, alpha, rgba } = field;
  const N = W * H;

  // 1. Sample opaque pixels.
  let opaque = 0;
  for (let i = 0; i < N; i++) if (alpha[i] > 0.95) opaque++;
  if (opaque < 64) return null;
  const step = Math.max(1, Math.floor(opaque / 40000));
  const list = [];
  for (let i = 0, seen = 0; i < N; i++) {
    if (alpha[i] <= 0.95) continue;
    if (seen++ % step) continue;
    list.push(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  const samples = Float32Array.from(list);
  const m = samples.length / 3;

  // 2. Cluster; drop empty/tiny clusters and near-duplicates.
  const rng = mulberry32(seed);
  const { centers: raw, counts } = kmeans(samples, Math.min(maxClusters, m), rng);
  const kept = [];
  for (let c = 0; c < counts.length; c++) {
    if (counts[c] < m * 0.002) continue;
    const col = [raw[c * 3], raw[c * 3 + 1], raw[c * 3 + 2]];
    if (kept.some((o) => Math.hypot(o[0] - col[0], o[1] - col[1], o[2] - col[2]) < 14)) continue;
    kept.push(col);
  }
  const k = kept.length;
  if (k < 2) return null;
  const centers = Float32Array.from(kept.flat());

  // 3. Label every visible pixel with its nearest cluster.
  const label = new Uint8Array(N).fill(255);
  for (let i = 0; i < N; i++) {
    if (alpha[i] < 0.02) continue;
    label[i] = nearest(centers, k, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }

  // 4. Classify each cluster pair's shared boundary as hard or smooth. A hard
  //    (anti-aliased) edge jumps most of the way between the two colors from
  //    one pixel to the next; a gradient creeps.
  const pairs = new Map();
  const cdist = (a, b) => Math.hypot(
    centers[a * 3] - centers[b * 3], centers[a * 3 + 1] - centers[b * 3 + 1], centers[a * 3 + 2] - centers[b * 3 + 2],
  );
  const visit = (p, q) => {
    const a = label[p], b = label[q];
    if (a === b || a === 255 || b === 255 || alpha[p] < MIN_ALPHA || alpha[q] < MIN_ALPHA) return;
    const key = a < b ? a * 16 + b : b * 16 + a;
    const d = Math.hypot(rgba[p * 4] - rgba[q * 4], rgba[p * 4 + 1] - rgba[q * 4 + 1], rgba[p * 4 + 2] - rgba[q * 4 + 2]);
    let e = pairs.get(key);
    if (!e) pairs.set(key, (e = { a: Math.min(a, b), b: Math.max(a, b), n: 0, hard: 0 }));
    e.n++;
    if (d > 0.3 * cdist(a, b)) e.hard++;
  };
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const p = y * W + x;
      visit(p, p + 1);
      visit(p, p + W);
    }
  }

  const parent = Array.from({ length: k }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const e of pairs.values()) {
    if (e.n < 8) continue;
    if (e.hard / e.n < 0.5) parent[find(e.a)] = find(e.b);
  }
  const regionOf = new Uint8Array(k);
  const ids = new Map();
  for (let c = 0; c < k; c++) {
    const root = find(c);
    if (!ids.has(root)) ids.set(root, ids.size);
    regionOf[c] = ids.get(root);
  }
  const count = ids.size;
  if (count < 2) return null;

  const regionMap = new Uint8Array(N).fill(255);
  for (let i = 0; i < N; i++) if (label[i] !== 255) regionMap[i] = regionOf[label[i]];

  /**
   * Soft membership mask for region r. Pixels on a region boundary get a
   * fractional weight from projecting their color between the two regions'
   * nearest cluster colors, so contours land with sub-pixel precision.
   */
  function mask(r) {
    const out = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const own = regionMap[i];
        if (own === 255) continue;
        let border = false;
        if (x > 0 && regionMap[i - 1] !== own && regionMap[i - 1] !== 255) border = true;
        else if (x < W - 1 && regionMap[i + 1] !== own && regionMap[i + 1] !== 255) border = true;
        else if (y > 0 && regionMap[i - W] !== own && regionMap[i - W] !== 255) border = true;
        else if (y < H - 1 && regionMap[i + W] !== own && regionMap[i + W] !== 255) border = true;
        if (!border) {
          out[i] = own === r ? alpha[i] : 0;
          continue;
        }
        // Nearest cluster in this pixel's region vs. nearest in any other.
        const pr = rgba[i * 4], pg = rgba[i * 4 + 1], pb = rgba[i * 4 + 2];
        let c1 = -1, d1 = Infinity, c2 = -1, d2 = Infinity;
        for (let c = 0; c < k; c++) {
          const dr = pr - centers[c * 3], dg = pg - centers[c * 3 + 1], db = pb - centers[c * 3 + 2];
          const d = dr * dr + dg * dg + db * db;
          if (regionOf[c] === own) { if (d < d1) { d1 = d; c1 = c; } }
          else if (d < d2) { d2 = d; c2 = c; }
        }
        let t = 0;
        if (c2 >= 0) {
          const vx = centers[c2 * 3] - centers[c1 * 3];
          const vy = centers[c2 * 3 + 1] - centers[c1 * 3 + 1];
          const vz = centers[c2 * 3 + 2] - centers[c1 * 3 + 2];
          const len2 = vx * vx + vy * vy + vz * vz || 1;
          t = ((pr - centers[c1 * 3]) * vx + (pg - centers[c1 * 3 + 1]) * vy + (pb - centers[c1 * 3 + 2]) * vz) / len2;
          t = Math.min(1, Math.max(0, t));
        }
        const w = own === r ? 1 - t : c2 >= 0 && regionOf[c2] === r ? t : 0;
        out[i] = alpha[i] * w;
      }
    }
    return out;
  }

  return { count, regionMap, mask };
}
