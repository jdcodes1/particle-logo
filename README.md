# Particle Logo

Interactive particle system that turns any SVG into a cloud of particles with mouse-reactive physics. Inspired by [particl.art](https://particl.art) and [Emil Kowalski's demo](https://x.com/emilkowalski/status/2036778116748542220).

**[Live Demo](https://particle-logo.vercel.app)**

## Features

- **SVG-to-particles** — renders any SVG to a hidden canvas, samples pixel data, and places particles at colored positions
- **Mouse interaction** — particles repel from cursor and spring back to their home positions
- **5 dithering algorithms** — Hex Grid + Jitter, Uniform Grid, Blue Noise (Poisson Disk), Halton Sequence, Bayer (Ordered)
- **Custom shaders** — soft or crisp circular particles via `gl_PointCoord` with configurable edge softness
- **Real-time controls** — density, particle size, size variance, softness, spring stiffness, damping, repel radius, repel strength
- **SVG upload** — drag & drop or paste SVG markup to use any logo
- **6 preset logos** — Linear, Netflix, GitHub, Apple, Heart, Star
- **Entrance animation** — particles scatter from random positions and converge into the logo shape

## Tech Stack

- React + Vite
- Three.js (WebGL `Points` with `BufferGeometry`)
- Custom GLSL vertex/fragment shaders

## Getting Started

```bash
npm install
npm run dev
```

## How It Works

1. **Sampling** — The SVG is drawn onto a hidden `<canvas>`. Pixel data is scanned and non-black/non-transparent pixels become particle candidates.
2. **Dithering** — A selected algorithm (hex grid, blue noise, etc.) determines particle placement to minimize visible banding.
3. **Rendering** — Particles are rendered as `THREE.Points` with per-particle position, color, and size via buffer attributes.
4. **Physics** — Each frame: spring force pulls particles home, mouse repels nearby particles, velocity is damped, positions are integrated.

## Using Custom SVGs

Pass any SVG string as a prop or use the upload/paste UI:

```jsx
<ParticleLogo svgString={mySvgString} width={400} height={400} config={config} />
```

Best results with simple, filled shapes on a dark background. The sampler ignores pixels that are too dark (`r < 25 && g < 25 && b < 25`) or transparent (`alpha < 80`).
