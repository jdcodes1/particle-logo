/**
 * SVG → coverage/color field.
 *
 * The SVG is normalized (namespace, viewBox, explicit size), trimmed to its
 * visible content, fit into the stage with "contain" semantics and rasterized
 * at a supersampled resolution. The result is a per-pixel coverage (alpha)
 * field plus un-premultiplied colors, which the layout algorithms sample.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const MAX_RASTER = 8192;

function parseLength(value) {
  if (!value) return null;
  const m = /^\s*([\d.]+)\s*(px)?\s*$/i.exec(value);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Parse SVG markup into a detached <svg> element with a guaranteed viewBox.
 * Returns { svg, viewBox: [x, y, w, h] }.
 */
export function parseSvg(markup) {
  let text = String(markup || '').trim();
  if (!/<svg[\s>]/i.test(text)) throw new Error('No <svg> element found');
  // Add missing namespaces — without them a data-URL <img> refuses to load.
  text = text.replace(/<svg\b(?![^>]*\bxmlns=)/i, `<svg xmlns="${SVG_NS}"`);
  if (/xlink:/.test(text)) {
    text = text.replace(/<svg\b(?![^>]*\bxmlns:xlink=)/i, `<svg xmlns:xlink="${XLINK_NS}"`);
  }

  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length || svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Could not parse SVG markup');
  }

  let viewBox = (svg.getAttribute('viewBox') || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
    const w = parseLength(svg.getAttribute('width')) || 300;
    const h = parseLength(svg.getAttribute('height')) || 150;
    viewBox = [0, 0, w, h];
    svg.setAttribute('viewBox', viewBox.join(' '));
  }
  return { svg, viewBox };
}

function loadSvgImage(svg, width, height) {
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('preserveAspectRatio', 'none');
  const markup = new XMLSerializer().serializeToString(svg);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The SVG could not be rendered'));
    img.src = url;
  });
}

function drawToCanvas(img, cw, ch, dx, dy, dw, dh) {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);
  return ctx.getImageData(0, 0, cw, ch).data;
}

/**
 * Detects an opaque, uniform backdrop (e.g. a full-size <rect fill="#000">)
 * by looking at the outermost ring of pixels. Returns its RGB or null.
 */
function detectBackdrop(px, w, h) {
  const samples = [];
  const push = (x, y) => {
    const i = (y * w + x) * 4;
    samples.push([px[i], px[i + 1], px[i + 2], px[i + 3]]);
  };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y); }

  const opaque = samples.filter((s) => s[3] > 240);
  if (opaque.length < samples.length * 0.9) return null;

  const median = [0, 1, 2].map((c) => {
    const v = opaque.map((s) => s[c]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const close = opaque.filter(
    (s) => Math.abs(s[0] - median[0]) + Math.abs(s[1] - median[1]) + Math.abs(s[2] - median[2]) < 24,
  );
  return close.length > samples.length * 0.85 ? median : null;
}

/** Converts raw RGBA into coverage, keying out a backdrop color if given. */
function extractCoverage(px, w, h, backdrop) {
  const alpha = new Float32Array(w * h);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    let a = px[p + 3] / 255;
    if (backdrop) {
      const dr = px[p] - backdrop[0], dg = px[p + 1] - backdrop[1], db = px[p + 2] - backdrop[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      // Soft key: 0 at the backdrop color, 1 once clearly different.
      const k = Math.min(1, Math.max(0, (dist - 6) / 42));
      const key = k * k * (3 - 2 * k);
      if (key > 0.25 && key < 1) {
        // Decontaminate edge colors that were blended with the backdrop.
        for (let c = 0; c < 3; c++) {
          px[p + c] = Math.min(255, Math.max(0, (px[p + c] - backdrop[c] * (1 - key)) / key));
        }
      }
      a *= key;
    }
    alpha[i] = a;
  }
  return alpha;
}

function contentBounds(alpha, w, h, threshold = 0.02) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * Rasterize an SVG into a field fitted to the stage.
 *
 * @param {string} markup SVG source
 * @param {object} opts
 * @param {number} opts.stageW stage width in units
 * @param {number} opts.stageH stage height in units
 * @param {number} opts.logoScale fraction of the stage the logo may occupy
 * @param {number} opts.supersample raster pixels per stage unit
 * @returns {Promise<Field>}
 */
export async function rasterizeSvg(markup, { stageW, stageH, logoScale = 0.62, supersample = 2 }) {
  const { svg, viewBox } = parseSvg(markup);
  const [, , vbW, vbH] = viewBox;

  // Pass 1 — find the visible content box (trims padding baked into the viewBox).
  const probeScale = 768 / Math.max(vbW, vbH);
  const pw = Math.max(8, Math.round(vbW * probeScale));
  const ph = Math.max(8, Math.round(vbH * probeScale));
  const probeImg = await loadSvgImage(svg, pw, ph);
  const probe = drawToCanvas(probeImg, pw, ph, 0, 0, pw, ph);
  const backdrop = detectBackdrop(probe, pw, ph);
  const probeAlpha = extractCoverage(probe, pw, ph, backdrop);
  const bounds = contentBounds(probeAlpha, pw, ph);
  if (!bounds) throw new Error('The SVG has no visible shapes');

  // Content box in normalized SVG coordinates, padded by one probe pixel.
  const bx0 = Math.max(0, bounds.x0 - 1) / pw;
  const by0 = Math.max(0, bounds.y0 - 1) / ph;
  const bx1 = Math.min(pw, bounds.x1 + 1) / pw;
  const by1 = Math.min(ph, bounds.y1 + 1) / ph;
  const contentW = (bx1 - bx0) * vbW;
  const contentH = (by1 - by0) * vbH;

  // Fit the content box into the stage (contain).
  const boxW = stageW * logoScale;
  const boxH = stageH * logoScale;
  const fit = Math.min(boxW / contentW, boxH / contentH);
  const logoW = contentW * fit;
  const logoH = contentH * fit;

  // Pass 2 — rasterize at full resolution.
  const ss = supersample;
  const W = Math.round(stageW * ss);
  const H = Math.round(stageH * ss);
  const fullW = vbW * fit * ss; // full SVG box, in raster px
  const fullH = vbH * fit * ss;
  const dx = (W - logoW * ss) / 2 - bx0 * fullW;
  const dy = (H - logoH * ss) / 2 - by0 * fullH;

  const imgW = Math.min(MAX_RASTER, Math.max(1, Math.round(fullW)));
  const imgH = Math.min(MAX_RASTER, Math.max(1, Math.round(fullH)));
  const img = await loadSvgImage(svg, imgW, imgH);
  const px = drawToCanvas(img, W, H, dx, dy, fullW, fullH);

  // Backdrops only exist inside the drawn SVG box; the stage around it is
  // transparent, so key using the color found in the probe pass.
  const alpha = extractCoverage(px, W, H, backdrop);

  return {
    width: W,
    height: H,
    ss,
    stageW,
    stageH,
    alpha,
    rgba: px,
    hadBackdrop: Boolean(backdrop),
    logo: { w: logoW, h: logoH },
  };
}
