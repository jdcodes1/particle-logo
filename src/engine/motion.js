/**
 * Pure motion helpers shared by the live engine and the standalone HTML
 * embed. They must stay self-contained (no imports, no module-level
 * references) because the embed inlines them via Function#toString().
 */

/** Smooth the raw pointer, derive its velocity and fade its influence. */
export function advancePointer(p, dt) {
  const k = 1 - Math.exp(-dt * 22);
  const nx = p.sx + (p.x - p.sx) * k;
  const ny = p.sy + (p.y - p.sy) * k;
  const f = dt * 60 || 1;
  p.vx = (nx - p.sx) / f;
  p.vy = (ny - p.sy) / f;
  p.sx = nx;
  p.sy = ny;
  const target = p.active ? 1 : 0;
  p.amt += (target - p.amt) * (1 - Math.exp(-dt * (p.active ? 10 : 5)));
  if (p.amt < 1e-3 && !p.active) p.amt = 0;
}

/**
 * Spring-damper offsets pushed around by the pointer. `home` is strided
 * (`stride` floats per particle). Frame-rate independent. Returns the total
 * motion energy so callers can sleep when everything has settled.
 */
export function stepSprings(off, vel, home, stride, count, p, cfg, dt) {
  const f = Math.min(3, dt * 60);
  const damp = Math.pow(cfg.damping, f);
  const k = cfg.spring;
  const R = cfg.repelRadius, R2 = R * R;
  const S = cfg.repelStrength * p.amt;
  const swirl = cfg.swirl;
  const drag = cfg.drag;
  const interact = p.amt > 0.01;
  let energy = 0;

  for (let i = 0; i < count; i++) {
    const ix = i * 2, iy = ix + 1;
    let ox = off[ix], oy = off[iy], vx = vel[ix], vy = vel[iy];
    if (interact) {
      const dx = home[i * stride] + ox - p.sx;
      const dy = home[i * stride + 1] + oy - p.sy;
      const d2 = dx * dx + dy * dy;
      if (d2 < R2 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const q = 1 - d / R;
        const fall = q * q * (3 - 2 * q);
        const nx = dx / d, ny = dy / d;
        vx += (nx * S - ny * S * swirl) * fall * f * 0.5;
        vy += (ny * S + nx * S * swirl) * fall * f * 0.5;
        vx += p.vx * drag * fall * f * 0.5;
        vy += p.vy * drag * fall * f * 0.5;
      }
    }
    vx = (vx - ox * k * f) * damp;
    vy = (vy - oy * k * f) * damp;
    ox += vx * f;
    oy += vy * f;
    off[ix] = ox;
    off[iy] = oy;
    vel[ix] = vx;
    vel[iy] = vy;
    energy += Math.abs(ox) + Math.abs(oy) + Math.abs(vx) + Math.abs(vy);
  }
  return energy;
}

/** Radial impulse (click burst). */
export function applyBurst(off, vel, home, stride, count, x, y, radius, strength) {
  for (let i = 0; i < count; i++) {
    const dx = home[i * stride] + off[i * 2] - x;
    const dy = home[i * stride + 1] + off[i * 2 + 1] - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > radius || d < 1e-3) continue;
    const q = 1 - d / radius;
    vel[i * 2] += (dx / d) * strength * q * q;
    vel[i * 2 + 1] += (dy / d) * strength * q * q;
  }
}

/**
 * Position of the sheen band along `dir` at `sinceIntro` seconds after the
 * intro finished, or 1e5 (off-screen) between sweeps.
 */
export function sheenPosition(bounds, dir, width, interval, sinceIntro) {
  const sweep = 2.2;
  if (sinceIntro < 0.4) return 1e5;
  const cs = [
    bounds.minX * dir[0] + bounds.minY * dir[1],
    bounds.maxX * dir[0] + bounds.minY * dir[1],
    bounds.minX * dir[0] + bounds.maxY * dir[1],
    bounds.maxX * dir[0] + bounds.maxY * dir[1],
  ];
  const lo = Math.min(cs[0], cs[1], cs[2], cs[3]) - width * 2.5;
  const hi = Math.max(cs[0], cs[1], cs[2], cs[3]) + width * 2.5;
  const t = (sinceIntro - 0.4) % (sweep + interval);
  if (t > sweep) return 1e5;
  const x = t / sweep;
  const e = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  return lo + (hi - lo) * e;
}

/** Spotlight gradient stops (center lift; light backgrounds darken at the edge). */
export function spotlightColors(c) {
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const mix = (a, t) => [c[0] + (a[0] - c[0]) * t, c[1] + (a[1] - c[1]) * t, c[2] + (a[2] - c[2]) * t];
  if (lum > 0.5) return { center: mix([1, 1, 1], 0.6), edge: mix([0, 0, 0], 0.045) };
  return { center: mix([1, 1, 1], 0.055), edge: c };
}
