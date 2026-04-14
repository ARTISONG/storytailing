// ─── 1. DUST PARTICLES — bass breathes them out, vacuum pulls them in ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

let _dustMotes = null;
let _smoothBass  = 0;   // slow-following bass baseline
let _beatImpulse = 0;   // energy released on each beat spike — decays fast

function initDust(w, h) {
  const cx = w / 2, cy = h / 2;
  _dustMotes = Array.from({ length: 520 }, (_, i) => {
    const angle  = Math.random() * Math.PI * 2;
    const radius = (0.05 + Math.random() * 0.55) * Math.min(w, h) * 0.45;
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0, vy: 0,
      size:       0.5 + Math.random() * 3.2,
      hue:        28 + Math.random() * 22,
      brightness: 0.25 + Math.random() * 0.75,
      phase:      Math.random() * Math.PI * 2,
      noiseOff:   i * 3.71,
      depth:      Math.random(),   // 0=far/dim, 1=near/bright
    };
  });
}

export function resetDust() {
  _dustMotes   = null;
  _smoothBass  = 0;
  _beatImpulse = 0;
}

export function renderLuminousDrift(ctx, w, h, t, bands) {
  if (!_dustMotes) initDust(w, h);

  const time    = t * 0.001;
  const bass    = bands.bass      || 0;
  const mid     = bands.mid       || 0;
  const pres    = bands.presence  || 0;
  const brill   = bands.brilliance|| 0;
  const overall = bands.overall   || 0;

  // ── Bass pulse analysis ──────────────────────────────────────────────────
  // Smooth baseline (40-frame lag) so sudden spikes stand out clearly
  _smoothBass  += (bass - _smoothBass)  * 0.055;

  // Beat impulse = amount bass EXCEEDS baseline this frame
  const spike   = Math.max(0, bass - _smoothBass - 0.04);
  _beatImpulse += spike * 6;
  _beatImpulse *= 0.82;   // punchy decay: ~half-life ≈ 3-4 frames (~55 ms)

  // Vacuum state: how quiet is the sustained bass (0 = loud, 1 = silent)
  const quietness = Math.max(0, 1 - _smoothBass * 5);

  // ── Warm light shafts ───────────────────────────────────────────────────
  for (let s = 0; s < 3; s++) {
    const sx = w * (0.25 + s * 0.25) + Math.sin(time * 0.1 + s) * w * 0.05;
    const al = 0.005 + bass * 0.007;
    const g  = ctx.createLinearGradient(sx - w * 0.08, 0, sx + w * 0.08, h);
    g.addColorStop(0,   hsl(38, 40, 50, al * 2));
    g.addColorStop(0.4, hsl(38, 30, 40, al));
    g.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(sx - w * 0.03, 0);
    ctx.lineTo(sx + w * 0.03, 0);
    ctx.lineTo(sx + w * 0.12, h);
    ctx.lineTo(sx - w * 0.12, h);
    ctx.closePath();
    ctx.fill();
  }

  const cx = w / 2, cy = h / 2;
  const minDim = Math.min(w, h);

  _dustMotes.forEach((d, di) => {
    // ── Radial geometry ────────────────────────────────────────────────
    const rx   = d.x - cx,  ry   = d.y - cy;
    const dist = Math.sqrt(rx * rx + ry * ry) + 0.001;
    const ux   = rx / dist, uy   = ry / dist;   // unit outward
    const tx   = -uy,       ty   = ux;           // unit tangential (CCW)

    // ── Brownian noise drift (gentle — doesn't fight bass physics) ─────
    const ns  = 0.035 + d.depth * 0.035;
    const nx  = simplex.noise3D(d.noiseOff,       time * ns, 0) * 0.35;
    const ny  = simplex.noise3D(0, d.noiseOff,    time * ns)    * 0.35;

    // ── OUTWARD PUSH — bass beat ───────────────────────────────────────
    // Scales with particle depth (near particles fly farther)
    const outForce = _beatImpulse * 1.1 * (0.55 + d.depth * 0.9)
                   * (0.4 + dist / (minDim * 0.4));  // outer particles get bigger kick

    // ── INWARD VACUUM PULL ─────────────────────────────────────────────
    // Always present; grows with distance (elastic restoring force)
    // AND with quietness — total silence = maximum suction
    const vacuumK    = (0.0018 + quietness * 0.006) * (0.6 + d.depth * 0.5);
    const inForce    = -dist * vacuumK;             // negative = toward center

    // Net radial
    const radial = outForce + inForce;

    // ── ORBITAL WOBBLE — makes return path spiral, not straight ────────
    // Modulated by noise so each particle has its own wandering curve
    const orbK = 0.12 + mid * 0.18;
    const orb  = simplex.noise2D(d.noiseOff * 0.28, time * 0.07) * orbK;

    // ── Integrate forces ───────────────────────────────────────────────
    d.vx += (ux * radial + tx * orb + nx) * 0.028;
    d.vy += (uy * radial + ty * orb + ny) * 0.028;

    // Damping: slightly stiffer when vacuuming in (suction feel)
    const damp = 0.984 - quietness * 0.006;
    d.vx *= damp;
    d.vy *= damp;

    d.x += d.vx * (0.45 + d.depth * 0.55);
    d.y += d.vy * (0.45 + d.depth * 0.55);

    // Soft boundary — prevent escape; bounce back gently
    const maxR = minDim * 0.62;
    if (dist > maxR) {
      d.vx *= 0.6;
      d.vy *= 0.6;
      d.x   = cx + ux * maxR * 0.9;
      d.y   = cy + uy * maxR * 0.9;
    }

    // ── Rendering ──────────────────────────────────────────────────────
    const speedSq      = d.vx * d.vx + d.vy * d.vy;
    const flicker      = 0.5 + Math.sin(time * 1.3 + d.phase) * 0.22
                             + Math.sin(time * 3.8 + di * 2.4) * 0.12;

    // Glow spikes on outward expansion (beat)
    const expandGlow   = Math.min(1, speedSq * 30 * _beatImpulse * 0.6);
    const audioGlow    = overall * 0.28 + brill * 0.22 + expandGlow;

    const size  = d.size * (0.55 + d.depth * 0.85)
                * (1 + bass * 0.45)
                * (0.72 + flicker * 0.42);
    const alpha = d.brightness
                * (0.06 + audioGlow + flicker * 0.10)
                * (0.38 + d.depth * 0.62);

    if (size < 0.3 || alpha < 0.01) return;

    // Hue warms on beat (golden flash), cools on vacuum (silvery)
    const hue   = d.hue
                + mid * 10
                + _beatImpulse * 10           // warmer gold on beat
                - quietness * 8               // cooler/silvery on vacuum
                + simplex.noise2D(di * 0.5, time * 0.13) * 7;
    const sat   = 32 + pres * 22 + _beatImpulse * 18;
    const light = 52 + brill * 16 + d.depth * 15 + expandGlow * 22;

    if (size > 2) {
      const glowR = size * (4.5 + _beatImpulse * 2.5);
      const gg = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, glowR);
      gg.addColorStop(0,   hsl(hue, sat,      light,      alpha * 0.75));
      gg.addColorStop(0.3, hsl(hue, sat - 12, light - 12, alpha * 0.22));
      gg.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(d.x, d.y, glowR, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = hsl(hue, sat + 12, light + 18, alpha * 1.35);
      ctx.beginPath(); ctx.arc(d.x, d.y, size * 0.5, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = hsl(hue, sat, light, alpha);
      ctx.beginPath(); ctx.arc(d.x, d.y, size, 0, Math.PI * 2); ctx.fill();
    }
  });
}
