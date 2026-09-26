/**
 * Shareable links: the current logo and settings, encoded in the URL hash.
 *
 * Format: `#s=<payload>`. Settings and preset ids are short, so they travel
 * as plain base64url JSON (decoded synchronously on load). A custom SVG is
 * deflated first (CompressionStream), which is why encoding is async and
 * why a link carrying an SVG resolves a moment after the page opens.
 */
// Explicit extension so plain Node (scripts/reply.mjs) can import this module too.
import { DEFAULT_CONFIG } from './config.js';

const VERSION = 1;
/** Browsers cap URLs well above this; we stay conservative so links survive chat apps. */
export const MAX_LINK_LENGTH = 12_000;

const b64url = {
  encode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  },
};

async function pipe(bytes, Stream) {
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Only the settings that differ from the defaults. */
export function configDiff(config) {
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (k in DEFAULT_CONFIG && DEFAULT_CONFIG[k] !== v) out[k] = v;
  }
  return out;
}

/**
 * Build a share URL. Returns { url, includesSvg }. A custom SVG that would
 * push the link past MAX_LINK_LENGTH is left out (settings still travel).
 */
export async function buildShareUrl({ source, config, base = location.href.split('#')[0] }) {
  const payload = { v: VERSION, c: configDiff(config) };
  let includesSvg = false;
  if (source.type === 'preset') {
    payload.p = source.id;
  } else if (typeof CompressionStream === 'function') {
    const packed = await pipe(new TextEncoder().encode(source.svg), CompressionStream);
    const candidate = { ...payload, z: b64url.encode(packed), n: source.name };
    const url = `${base}#s=${b64url.encode(new TextEncoder().encode(JSON.stringify(candidate)))}`;
    if (url.length <= MAX_LINK_LENGTH) return { url, includesSvg: true };
  }
  return {
    url: `${base}#s=${b64url.encode(new TextEncoder().encode(JSON.stringify(payload)))}`,
    includesSvg,
  };
}

/**
 * Parse the current URL hash. Returns null when there's nothing to load,
 * otherwise { config, preset?, svg?: Promise<{ svg, name }> }.
 */
export function parseShareHash(hash = location.hash) {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64url.decode(m[1])));
    if (payload.v !== VERSION) return null;
    const result = { config: payload.c && typeof payload.c === 'object' ? payload.c : {} };
    if (typeof payload.p === 'string') result.preset = payload.p;
    if (typeof payload.z === 'string' && typeof DecompressionStream === 'function') {
      result.svg = pipe(b64url.decode(payload.z), DecompressionStream).then((bytes) => ({
        svg: new TextDecoder().decode(bytes),
        name: typeof payload.n === 'string' ? payload.n : 'shared',
      }));
    }
    return result;
  } catch {
    return null;
  }
}
