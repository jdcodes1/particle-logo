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
