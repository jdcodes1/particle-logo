/**
 * Iso-contour extraction (marching squares) and contour resampling.
 *
 * Contours are traced on the coverage field at iso = 0.5, chained into closed
 * loops with sub-pixel vertex positions, then resampled at an even spacing
 * with sharp corners pinned so particle outlines keep crisp geometry.
 */

/** Bilinear sample of a scalar field at raster coordinates (pixel centers at +0.5). */
export function sampleField(field, w, h, x, y) {
  const fx = x - 0.5, fy = y - 0.5;
  let x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const x1 = Math.min(w - 1, Math.max(0, x0 + 1));
  const y1 = Math.min(h - 1, Math.max(0, y0 + 1));
  x0 = Math.min(w - 1, Math.max(0, x0));
  y0 = Math.min(h - 1, Math.max(0, y0));
  const a = field[y0 * w + x0], b = field[y0 * w + x1];
  const c = field[y1 * w + x0], d = field[y1 * w + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * Trace closed iso-contours. Returns an array of loops, each a flat
 * Float64Array [x0, y0, x1, y1, ...] in raster coordinates.
 */
export function traceContours(field, w, h, iso = 0.5) {
  const PW = w + 2; // padded width (zero border guarantees closed loops)
  const val = (I, J) => {
    const i = I - 1, j = J - 1;
    return i < 0 || j < 0 || i >= w || j >= h ? 0 : field[j * w + i];
  };
  const hId = (I, J) => (J * PW + I) * 2;
  const vId = (I, J) => (J * PW + I) * 2 + 1;

  const points = new Map(); // edgeId -> [x, y]
  const links = new Map(); // edgeId -> [a, b]

  const point = (id) => {
    if (points.has(id)) return;
    const cell = id >> 1;
    const I = cell % PW, J = (cell - I) / PW;
    if (id & 1) {
      const a = val(I, J), b = val(I, J + 1);
      const t = (iso - a) / (b - a);
      points.set(id, [I - 0.5, J + t - 0.5]);
    } else {
      const a = val(I, J), b = val(I + 1, J);
      const t = (iso - a) / (b - a);
      points.set(id, [I + t - 0.5, J - 0.5]);
    }
  };
  const link = (a, b) => {
    point(a);
    point(b);
    const la = links.get(a);
    if (la) la.push(b); else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a); else links.set(b, [a]);
  };

  for (let J = 0; J <= h; J++) {
    for (let I = 0; I <= w; I++) {
      const tl = val(I, J), tr = val(I + 1, J), br = val(I + 1, J + 1), bl = val(I, J + 1);
      const code = (tl >= iso ? 8 : 0) | (tr >= iso ? 4 : 0) | (br >= iso ? 2 : 0) | (bl >= iso ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = hId(I, J), bottom = hId(I, J + 1), left = vId(I, J), right = vId(I + 1, J);
      switch (code) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(left, top); break;
        case 5: case 10: {
          const center = (tl + tr + br + bl) / 4 >= iso;
          const tlInside = code === 10;
          // When the center matches the diagonal that is inside, the inside
          // corners connect through the middle and the outside corners are cut.
          if (center === tlInside) { link(top, right); link(left, bottom); }
          else { link(left, top); link(bottom, right); }
          break;
        }
      }
    }
  }

  const visited = new Set();
  const loops = [];
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const loop = [];
    let prev = -1, cur = start;
    while (cur !== undefined && !visited.has(cur)) {
      visited.add(cur);
      const p = points.get(cur);
      loop.push(p[0], p[1]);
      const next = links.get(cur);
      const n = next[0] !== prev ? next[0] : next[1];
      prev = cur;
      cur = n;
    }
    if (loop.length >= 6) loops.push(Float64Array.from(loop));
  }
  return loops;
}

function loopLength(loop) {
  const n = loop.length / 2;
  let len = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    len += Math.hypot(loop[j * 2] - loop[i * 2], loop[j * 2 + 1] - loop[i * 2 + 1]);
  }
  return len;
}

/** Signed area (shoelace), used to find centroids of tiny loops. */
function loopCentroid(loop) {
  const n = loop.length / 2;
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = loop[i * 2], y0 = loop[i * 2 + 1], x1 = loop[j * 2], y1 = loop[j * 2 + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(a) < 1e-9) return [loop[0], loop[1]];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Finds vertices where the contour turns sharply. The turning angle is
 * measured over an arc-length window so pixel-level noise is ignored.
 */
function findCorners(loop, window, minAngle) {
  const n = loop.length / 2;
  if (n < 8) return [];
  // Cumulative arc length for window lookups.
  const s = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s[i + 1] = s[i] + Math.hypot(loop[j * 2] - loop[i * 2], loop[j * 2 + 1] - loop[i * 2 + 1]);
  }
  const total = s[n];
  if (total < window * 4) return [];

  const angle = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Neighbors roughly `window` arc-length away on each side.
    let back = (i - 1 + n) % n;
    while (back !== i && arcDist(s, total, back, i) < window) back = (back - 1 + n) % n;
    let fwd = (i + 1) % n;
    while (fwd !== i && arcDist(s, total, i, fwd) < window) fwd = (fwd + 1) % n;

    const ax = loop[i * 2] - loop[back * 2], ay = loop[i * 2 + 1] - loop[back * 2 + 1];
    const bx = loop[fwd * 2] - loop[i * 2], by = loop[fwd * 2 + 1] - loop[i * 2 + 1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = (ax * bx + ay * by) / (la * lb);
    angle[i] = Math.acos(Math.max(-1, Math.min(1, cos)));
  }

  // Non-maximum suppression within the window.
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (angle[i] < minAngle) continue;
    let isMax = true;
    for (let k = 1; k < n && arcDist(s, total, i, (i + k) % n) < window * 1.5; k++) {
      if (angle[(i + k) % n] > angle[i]) { isMax = false; break; }
    }
    for (let k = 1; isMax && k < n && arcDist(s, total, (i - k + n) % n, i) < window * 1.5; k++) {
      if (angle[(i - k + n) % n] >= angle[i]) { isMax = false; break; }
    }
    if (isMax) corners.push(i);
  }
  return corners;
}

function arcDist(s, total, a, b) {
  const d = s[b] - s[a];
  return d >= 0 ? d : d + total;
}

/** Evenly resample the open polyline loop[from..to] (indices, wrapping). */
function resampleSpan(loop, from, to, spacing, out, includeStart) {
  const n = loop.length / 2;
  const idx = [];
  for (let i = from; ; i = (i + 1) % n) {
    idx.push(i);
    if (i === to && idx.length > 1) break;
    if (idx.length > n + 1) break;
  }
  let len = 0;
  const seg = [];
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k], b = idx[k + 1];
    const d = Math.hypot(loop[b * 2] - loop[a * 2], loop[b * 2 + 1] - loop[a * 2 + 1]);
    seg.push(d);
    len += d;
  }
  const count = Math.max(1, Math.round(len / spacing));
  const step = len / count;
  let k = 0, acc = 0;
  for (let m = includeStart ? 0 : 1; m < count; m++) {
    const target = m * step;
    while (k < seg.length - 1 && acc + seg[k] < target) acc += seg[k++];
    const t = seg[k] > 0 ? (target - acc) / seg[k] : 0;
    const a = idx[k], b = idx[k + 1];
    out.push(
      loop[a * 2] + (loop[b * 2] - loop[a * 2]) * t,
      loop[a * 2 + 1] + (loop[b * 2 + 1] - loop[a * 2 + 1]) * t,
    );
  }
}

/**
 * Resample all loops at `spacing` (raster px). Sharp corners are always kept.
 * Tiny loops collapse to their centroid. Returns flat [x, y, ...] points.
 */
export function resampleContours(loops, spacing, { cornerAngle = 0.7 } = {}) {
  const out = [];
  const singles = [];
  for (const loop of loops) {
    const len = loopLength(loop);
    if (len < spacing * 2.2) {
      singles.push(loopCentroid(loop));
      continue;
    }
    const corners = findCorners(loop, Math.max(1.5, spacing * 0.45), cornerAngle);
    if (corners.length === 0) {
      // Closed loop: sample from vertex 0 around back to itself.
      const n = loop.length / 2;
      const closed = new Float64Array(loop.length + 2);
      closed.set(loop);
      closed[loop.length] = loop[0];
      closed[loop.length + 1] = loop[1];
      resampleSpan(closed, 0, n, spacing, out, true);
    } else {
      for (let c = 0; c < corners.length; c++) {
        const from = corners[c];
        const to = corners[(c + 1) % corners.length];
        resampleSpan(loop, from, to === from ? (from - 1 + loop.length / 2) % (loop.length / 2) : to, spacing, out, true);
      }
    }
  }
  return { points: out, singles };
}
