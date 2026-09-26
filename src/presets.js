/**
 * Sample logos — original marks, so screenshots and exports are free to
 * share. All use transparent backgrounds; the sampler trims empty space and
 * fits the visible content to the stage automatically.
 */

export const PRESET_LOGOS = {
  orbit: {
    name: 'Orbit',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="24" fill="#f5f5f7"/>
  <path d="M50 8a42 42 0 1 1-29.7 12.3" fill="none" stroke="#f5f5f7" stroke-width="9" stroke-linecap="round"/>
  <circle cx="20.3" cy="20.3" r="7" fill="#7c7cff"/>
</svg>`,
  },
  prism: {
    name: 'Prism',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="p" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#22d3ee"/>
      <stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
  </defs>
  <path d="M50 8 L94 86 H6 Z" fill="url(#p)" stroke="url(#p)" stroke-width="8" stroke-linejoin="round"/>
  <path d="M50 42 L70 78 H30 Z" fill="#0a0a0b"/>
</svg>`,
  },
  wave: {
    name: 'Wave',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 100">
  <path d="M8 62c14-30 26-30 40 0s26 30 40 0 26-30 24-8" fill="none" stroke="#34d399" stroke-width="14" stroke-linecap="round"/>
</svg>`,
  },
  hex: {
    name: 'Hex',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M50 4 90 27v46L50 96 10 73V27z" fill="#f5f5f7"/>
  <path d="M50 30 68 40.5v21L50 72 32 61.5v-21z" fill="#0a0a0b"/>
  <path d="M50 4 90 27v46L50 96 10 73V27z" fill="none" stroke="#fb923c" stroke-width="7" stroke-linejoin="round"/>
</svg>`,
  },
  mark: {
    name: 'Wordmark',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 290 80">
  <g fill="#f5f5f7">
    <path d="M10 70 34 10h14l24 60H57l-5-14H30l-5 14zm24-26h14l-7-20z"/>
    <path d="M84 40q0-31 30-31 20 0 27 15l-13 6q-4-8-14-8-15 0-15 18t15 18q10 0 14-8l13 6q-7 15-27 15-30 0-30-31z"/>
    <path d="M148 70V10h16l20 36 20-36h16v60h-15V38l-16 28h-10l-16-28v32z"/>
    <path d="M238 70V10h44v13h-29v10h26v13h-26v11h30v13z"/>
  </g>
</svg>`,
  },
  spark: {
    name: 'Spark',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f472b6"/>
      <stop offset="0.5" stop-color="#8b5cf6"/>
      <stop offset="1" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
  <path fill="url(#g)" d="M50 0C52.6 29 71 47.4 100 50C71 52.6 52.6 71 50 100C47.4 71 29 52.6 0 50C29 47.4 47.4 29 50 0Z"/>
</svg>`,
  },
  heart: {
    name: 'Heart',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 3 20 18.35">
  <path fill="#ff375f" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
</svg>`,
  },
  app: {
    name: 'App Icon',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b7cff"/>
      <stop offset="1" stop-color="#4338ca"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="23" fill="url(#tile)"/>
  <path fill="#ffffff" d="M57 13 L27 55 H47 L41 87 L73 42 H53 Z"/>
</svg>`,
  },
};
