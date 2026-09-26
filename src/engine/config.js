/** Stage aspect ratios, in abstract stage units. */
export const ASPECTS = {
  '1:1': { name: 'Square', w: 800, h: 800 },
  '4:5': { name: 'Portrait', w: 800, h: 1000 },
  '16:9': { name: 'Wide', w: 1280, h: 720 },
  '9:16': { name: 'Story', w: 720, h: 1280 },
};

export const DEFAULT_CONFIG = {
  // Composition
  aspect: '1:1',
  logoScale: 0.62,

  // Layout (changing these re-samples the logo)
  layout: 'organic',
  gap: 5.5,
  gridShape: 'hex',
  edgeInset: 0.3,
  toneGamma: 1,
  ditherThreshold: 0.5,
  ditherInvert: false,
  seed: 7,

  // Particles
  dotSize: 3.6,
  sizeVariance: 0.1,
  brightnessVariance: 0.08,
  softness: 0,
  glow: 0.1,
  glowSize: 4,

  // Color
  colorMode: 'original',
  color: '#f5f5f7',
  gradientFrom: '#8b5cf6',
  gradientTo: '#22d3ee',
  gradientAngle: 35,
  background: '#0a0a0b',
  spotlight: true,

  // Motion
  intro: 'assemble',
  introSpeed: 1,
  idle: 0.35,
  twinkle: 0.05,
  sheen: 0.45,
  sheenInterval: 4.5,

  // Interaction
  repelRadius: 95,
  repelStrength: 4,
  swirl: 0.2,
  drag: 0.3,
  spring: 0.055,
  damping: 0.84,
  lens: 0.3,
  tilt: 0.4,
  clickBurst: true,
};

/** Config keys that require the logo to be re-rasterized. */
export const RASTER_KEYS = ['aspect', 'logoScale'];

/** Config keys that require a new particle layout. */
export const LAYOUT_KEYS = [
  'layout', 'gap', 'gridShape', 'edgeInset', 'toneGamma', 'ditherThreshold', 'ditherInvert', 'seed',
];

/** Tone-based layouts also depend on the color mode (see buildLayout). */
export function layoutKeyOf(cfg) {
  const keys = LAYOUT_KEYS.map((k) => String(cfg[k]));
  if (cfg.layout === 'halftone' || cfg.layout === 'dither') keys.push(cfg.colorMode);
  return keys.join('|');
}

/**
 * Curated looks: one click sets every visual parameter to a tuned
 * combination. Color and background are left alone so brand colors stay.
 */
const LOOK_BASE = {
  layout: 'organic', gap: 5.5, gridShape: 'hex', edgeInset: 0.3, dotSize: 3.6, sizeVariance: 0.1,
  brightnessVariance: 0.08, softness: 0, glow: 0.1, glowSize: 4, idle: 0.35, twinkle: 0.05, sheen: 0.45,
};

export const LOOKS = {
  studio: { name: 'Studio', settings: { ...LOOK_BASE } },
  minimal: {
    name: 'Minimal',
    settings: { ...LOOK_BASE, gap: 5, dotSize: 3.4, sizeVariance: 0, brightnessVariance: 0, glow: 0, twinkle: 0, sheen: 0, idle: 0.2 },
  },
  neon: {
    name: 'Neon',
    settings: { ...LOOK_BASE, gap: 6, dotSize: 3.4, softness: 0, glow: 0.3, glowSize: 3.2, brightnessVariance: 0.12, twinkle: 0.12, sheen: 0.6 },
  },
  constellation: {
    name: 'Constellation',
    settings: { ...LOOK_BASE, gap: 7.5, edgeInset: 0.25, dotSize: 2.6, sizeVariance: 0.5, brightnessVariance: 0.3, glow: 0.22, glowSize: 5, twinkle: 0.3, idle: 0.9, sheen: 0.3 },
  },
  bokeh: {
    name: 'Bokeh',
    settings: { ...LOOK_BASE, gap: 7, dotSize: 6.5, softness: 0.75, sizeVariance: 0.35, brightnessVariance: 0.2, glow: 0.06, twinkle: 0.1, idle: 0.6, sheen: 0.3 },
  },
  led: {
    name: 'LED',
    settings: { ...LOOK_BASE, layout: 'grid', gridShape: 'square', gap: 6, dotSize: 4.6, sizeVariance: 0, brightnessVariance: 0, softness: 0.1, glow: 0.18, twinkle: 0, idle: 0, sheen: 0.3 },
  },
  halftone: {
    name: 'Halftone',
    settings: { ...LOOK_BASE, layout: 'halftone', gridShape: 'hex', gap: 6.5, dotSize: 7, sizeVariance: 0, brightnessVariance: 0, glow: 0, twinkle: 0, idle: 0.15, sheen: 0 },
  },
  dither: {
    name: 'Dither',
    settings: { ...LOOK_BASE, layout: 'dither', gap: 4, dotSize: 3.2, sizeVariance: 0, brightnessVariance: 0, glow: 0.05, twinkle: 0, idle: 0.15, sheen: 0.3 },
  },
};

/** The look whose settings the config currently matches, if any. */
export function activeLook(cfg) {
  for (const [key, look] of Object.entries(LOOKS)) {
    if (Object.entries(look.settings).every(([k, v]) => cfg[k] === v)) return key;
  }
  return null;
}
