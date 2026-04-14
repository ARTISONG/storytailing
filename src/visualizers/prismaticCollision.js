// ── QUANTUM STELLAR SPECTRUM ─────────────────────────────────────────────────
// A quantum star emits spectral radiation across 7 discrete energy levels (QHO).
// Rotation is tempo-synced; beat and dB trigger layered reactive effects.
//
// Mathematical foundations:
//   • QHO energy levels:       Eₙ = ℏω(n+½)  →  rₙ = r₀√(2n+1)
//   • Bessel function J₀(x):   A&S §9.4.1 polynomial (|err|<5×10⁻⁸)
//   • Ring modulation:          r(θ) = rₙ·breathe + kick + A·sin(ℓθ−ωt) + B·J₀(ℓθk)
//   • Beat phase breathing:     breathe(φ) = 1 + 0.015·cos(2πφ)
//   • Tempo detection:          median of last 8 inter-onset intervals (IOI)
//   • Rotation:                 Δθ = (2π / BEATS_PER_REV) · (dt / interval)
//   • Beat kick:                kickOffset = E·r₀·0.28  →  decay ×0.88/frame
//   • Lissajous photon paths:   x=sin(at+δ), y=sin(bt)  → angular perturbation
//   • Chromatic map:            hue ∈ [5°(red)…260°(violet)]  (ROYGBIV)
// ─────────────────────────────────────────────────────────────────────────────

import { hsl } from "../utils/audio.js";

// ── Module state ──────────────────────────────────────────────────────────────
let _cx = 0, _cy = 0, _r0 = 0;
let _w = 0,  _h  = 0;
let _initialized = false;

// audio / beat
let _beatSmooth  = 0;
let _beatHistory = [];     // recent inter-onset intervals (ms)
let _beatInterval = 600;   // estimated ms/beat  (default 100 BPM)
let _lastBeatT   = 0;
let _beatPhase   = 0;      // 0→1 within current beat cycle
let _kickOffset  = 0;      // ring outward kick, decays each frame
let _beatFlash   = 0;      // star corona brightness boost, decays

// rotation (tempo-synced)
let _rotAngle    = 0;      // accumulated beam rotation angle (radians)
let _prevT       = 0;      // last frame timestamp for Δt

// visual objects
let _particles   = [];
let _beatRipples = [];     // expanding chromatic shockwave rings on beat
let _qPhase      = 0;      // quantum colour-cycle phase (independent of audio)

// ── Spectral configuration ────────────────────────────────────────────────────
const BAND_KEYS  = ['subBass','bass','lowMid','mid','highMid','presence','brilliance'];
const SPEC_HUES  = [5, 30, 60, 120, 180, 220, 260];  // Red → Violet (ROYGBIV)
const NUM_LEVELS = 7;
const MAX_PART   = 220;
const BEATS_PER_REV = 32;   // 1 full beam rotation = 32 beats

// ── ฉัพพรรณรังสี — 6 sacred light colors ─────────────────────────────────────
const C_NIL = [89,  199, 107];  // นีลเขียว   — ดอกอัญชัน ปีกแมลงภู่
const C_PIT = [235, 204,  51];  // ปีตเหลือง  — ดอกกรรณิการ์ หรดาลทอง
const C_LOH = [217,  56,  51];  // โลหิตแดง   — น้ำครั่ง ดอกชบา
const C_OTH = [230, 235, 242];  // โอทาตขาว   — แผ่นเงิน เงินยวง
const C_MAN = [242, 115,  38];  // มัญเชฐแสด  — หงอนไก่ ดอกเซ่ง
const C_PRA = [191, 217, 242];  // ประภัสสร   — แก้วผลึกเลื่อมพราย
const CHAP6 = [C_NIL, C_PIT, C_LOH, C_OTH, C_MAN, C_PRA];

// rgba helper + lighten (blend toward white by factor f)
const cc      = (r, g, b, a)  => `rgba(${r},${g},${b},${Math.max(0,Math.min(1,a))})`;
const lighten = ([r,g,b], f)  => [r+(255-r)*f|0, g+(255-g)*f|0, b+(255-b)*f|0];

// ── Bessel J₀(x) — A&S §9.4.1, |err| < 5×10⁻⁸ ──────────────────────────────
function J0(x) {
  const t = x < 0 ? -x : x;
  if (t <= 3.75) {
    const u = (t / 3.75) ** 2;
    return 1 + u * (-2.2499997 + u * (1.2656208 + u * (-0.3163866 +
                    u * (0.0444479  + u * (-0.0039444 + u *  0.0002100)))));
  }
  const u = 3.75 / t;
  return (0.39894228 + u * (0.01328592 + u * (0.00225319 + u * (-0.00157565 +
          u * (0.00916281 + u * (-0.02057706 + u * (0.02635537 + u * (-0.01647633 +
          u *  0.00392377)))))))) / Math.sqrt(t) * Math.cos(t - Math.PI / 4);
}

const qhoR = (n) => _r0 * Math.sqrt(2 * n + 1);

// ── Init ──────────────────────────────────────────────────────────────────────
function init(w, h) {
  _cx = w / 2;  _cy = h / 2;
  _r0 = Math.min(w, h) * 0.078;
  _w = w;  _h = h;
  _particles   = [];
  _beatRipples = [];
  _beatSmooth  = 0;
  _beatHistory = [];
  _beatInterval = 600;
  _lastBeatT   = 0;
  _beatPhase   = 0;
  _kickOffset  = 0;
  _beatFlash   = 0;
  _rotAngle    = 0;
  _prevT       = 0;
  _qPhase      = 0;
  _initialized = true;
}

// ── Tempo detection (median inter-onset interval) ─────────────────────────────
// On each beat: record interval, compute median of last 8 → estimate BPM.
// Triggers beat effects: kick, ripple, flash.
function updateTempo(t, isBeat, beatPulse) {
  if (isBeat && (t - _lastBeatT) > 220) {   // debounce: 220ms = max ~272 BPM
    const interval = _lastBeatT > 0 ? t - _lastBeatT : 0;
    if (interval > 220 && interval < 2500) { // valid range: 24–272 BPM
      _beatHistory.push(interval);
      if (_beatHistory.length > 8) _beatHistory.shift();
      const sorted = [..._beatHistory].sort((a, b) => a - b);
      _beatInterval = sorted[Math.floor(sorted.length / 2)];
    }
    _lastBeatT  = t;

    // ── Trigger beat effects ──────────────────────────────────────────────
    _kickOffset = beatPulse * _r0 * 0.30;            // ring expansion kick
    _beatFlash  = 0.55 + beatPulse * 0.45;           // star corona flash

    // Chromatic shockwave ring
    _beatRipples.push({
      r:     _r0 * 0.90,
      hue:   (_qPhase * 0.5) % 360,
      alpha: 0.80 + beatPulse * 0.20,
      speed: 5 + beatPulse * 12,
      width: 2.5 + beatPulse * 3.5,
    });
  }

  // Beat phase φ ∈ [0,1]: 0 = on beat, 1 ≈ next beat
  _beatPhase = _lastBeatT > 0
    ? Math.min(1, (t - _lastBeatT) / _beatInterval)
    : 0;
}

// ── Spawn photon particle ─────────────────────────────────────────────────────
function spawnParticle(n, energy) {
  if (_particles.length >= MAX_PART) return;
  const lA = 1 + Math.floor(Math.random() * 4);
  const lB = 1 + Math.floor(Math.random() * 5);
  _particles.push({
    angle:  Math.random() * Math.PI * 2,
    r:      _r0 * (0.25 + Math.random() * 0.45),
    speed:  (0.60 + Math.random() * 1.70) * (1 + energy * 0.55),
    maxR:   qhoR(n) * (1.20 + Math.random() * 1.05),
    hue:    SPEC_HUES[n],
    size:   1.0 + Math.random() * 2.6,
    life:   0,
    lA, lB,
    lPhase: Math.random() * Math.PI * 2,
    wind:   Math.random() < 0.5 ? 1 : -1,
  });
}

// ── Layer 0 — Quantum field foam ──────────────────────────────────────────────
function drawFoam(ctx, bands, w, h) {
  const n = Math.floor(15 + bands.overall * 50);
  for (let i = 0; i < n; i++) {
    const x   = Math.random() * w;
    const y   = Math.random() * h;
    const hue = Math.random() * 360;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + Math.random() * 1.2, 0, Math.PI * 2);
    ctx.fillStyle = hsl(hue, 80, 88, 0.07 + Math.random() * 0.07);
    ctx.fill();
  }
}

// ── Layer 1 — Spectral emission beams (tempo-synced rotation) ─────────────────
// Rotation angle is accumulated via Δθ = (2π/32beats)·(dt/interval) each frame.
// Beam waviness adds transverse oscillation ("radiation wave" appearance).
// Beam width and opacity scale with dB (bands.overall).
function drawBeams(ctx, bands, t, w, h) {
  const NUM_BEAMS = 28;
  const outerR    = Math.max(w, h) * 0.70;
  const dbBoost   = 1 + bands.overall * 0.55;   // dB-reactive width scale
  const beatW     = 1 + _beatFlash * 0.9;       // beat-reactive width boost

  for (let i = 0; i < NUM_BEAMS; i++) {
    const angle = (i / NUM_BEAMS) * Math.PI * 2 + _rotAngle;

    // Interpolate spectral level across beam index
    const frac   = (i / NUM_BEAMS) * (NUM_LEVELS - 1);
    const lo     = Math.floor(frac);
    const hi     = Math.min(NUM_LEVELS - 1, lo + 1);
    const lerp   = frac - lo;
    const energy = bands[BAND_KEYS[lo]] * (1 - lerp) + bands[BAND_KEYS[hi]] * lerp;
    const hue    = SPEC_HUES[lo] * (1 - lerp) + SPEC_HUES[hi] * lerp;
    const eff    = Math.max(0.018, energy);

    // Lateral (transverse) wave oscillation along beam
    const latAmp  = 22 * eff * dbBoost;
    const latFreq = 0.018;
    const latShft = t * 0.00110 + i * 2.31;

    const STEPS = 40;
    ctx.beginPath();
    for (let s = 0; s <= STEPS; s++) {
      const f   = s / STEPS;
      const r   = f * outerR;
      const lat = latAmp * Math.sin(r * latFreq + latShft);
      const px  = _cx + r * Math.cos(angle) + (-Math.sin(angle)) * lat;
      const py  = _cy + r * Math.sin(angle) + ( Math.cos(angle)) * lat;
      s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }

    const ex   = _cx + outerR * Math.cos(angle);
    const ey   = _cy + outerR * Math.sin(angle);
    const grad = ctx.createLinearGradient(_cx, _cy, ex, ey);
    const ao   = eff * (0.80 + bands.overall * 0.20);  // dB-boosted opacity
    grad.addColorStop(0.00, hsl(hue, 100, 96, ao * 0.85));
    grad.addColorStop(0.10, hsl(hue, 100, 84, ao * 0.58));
    grad.addColorStop(0.42, hsl(hue, 100, 68, ao * 0.22));
    grad.addColorStop(1.00, hsl(hue, 100, 55, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth   = (0.7 + eff * 2.8) * dbBoost * beatW;
    ctx.stroke();
  }
}

// ── Layer 2 — Quantum energy-level rings ─────────────────────────────────────
// Ring radius breathes with beat phase φ: breathe = 1 + 0.015·cos(2πφ)
// On beat: kickOffset pushes rings outward, decaying back each frame.
// dB (overall) boosts glow alpha and wobble amplitude.
function drawQuantumRing(ctx, n, energy, t, w, h) {
  // Beat phase breathing: contracts approaching beat, expands on beat
  const breathe = 1 + 0.018 * Math.cos(_beatPhase * Math.PI * 2);
  // Kick decays faster for outer rings (inner rings feel it more)
  const kick    = _kickOffset * Math.max(0, 1 - n * 0.11);
  const rN      = qhoR(n) * breathe + kick;

  if (rN > Math.min(w, h) * 0.62) return;

  const hue    = SPEC_HUES[n];
  const lobes  = n * 2 + 3;
  const dbBoost = 1 + energy * 0.9 + _w > 0 ? 0 : 0;   // just energy already
  const wobble  = rN * 0.045 * (1 + energy * 1.6 + _beatFlash * 0.4);
  const omega   = 0.0095 * (n * 0.65 + 1);
  const SEGS    = 160;
  const alpha   = 0.10 + energy * 0.70 + _beatFlash * 0.18;

  const passes = [
    { extra: rN * 0.055, aMult: 0.13, lw: 18 + energy * 22 + _beatFlash * 12, lit: 92 },
    { extra: rN * 0.022, aMult: 0.32, lw:  6 + energy *  9 + _beatFlash *  5, lit: 82 },
    { extra: 0,          aMult: 1.00, lw:  2 + energy *  4 + _beatFlash *  2, lit: 70 },
  ];

  passes.forEach(({ extra, aMult, lw, lit }) => {
    ctx.beginPath();
    for (let i = 0; i <= SEGS; i++) {
      const theta     = (i / SEGS) * Math.PI * 2;
      const sinMod    = wobble * Math.sin(lobes * theta - omega * t + n * 0.90);
      const besselArg = lobes * 0.38 + lobes * theta * 0.095;
      const besselMod = J0(besselArg) * energy * rN * 0.028;
      const rEff      = rN + sinMod + besselMod + extra;
      const px = _cx + rEff * Math.cos(theta);
      const py = _cy + rEff * Math.sin(theta);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = hsl(hue, 100, lit, alpha * aMult);
    ctx.lineWidth   = lw;
    ctx.stroke();
  });
}

// ── Layer 3 — Beat shockwave ripples ─────────────────────────────────────────
// Each beat spawns an expanding chromatic ring (3 sub-rings for prismatic effect).
// Speed decelerates (×0.96/frame); alpha fades until removed.
function drawBeatRipples(ctx) {
  for (let i = _beatRipples.length - 1; i >= 0; i--) {
    const rp  = _beatRipples[i];
    rp.r     += rp.speed;
    rp.speed *= 0.962;   // decelerate (momentum dissipation)
    rp.alpha *= 0.940;   // fade

    if (rp.alpha < 0.012) { _beatRipples.splice(i, 1); continue; }

    // 3 chromatic sub-rings (thin-film dispersion simulation)
    for (let sub = 0; sub < 3; sub++) {
      const subR = rp.r + sub * 7;
      const subH = (rp.hue + sub * 42) % 360;
      ctx.beginPath();
      ctx.arc(_cx, _cy, subR, 0, Math.PI * 2);
      ctx.strokeStyle = hsl(subH, 100, 90, rp.alpha * (1 - sub * 0.28));
      ctx.lineWidth   = rp.width * (1 - sub * 0.22);
      ctx.stroke();
    }
  }
}

// ── Layer 4 — Lissajous photon particles ─────────────────────────────────────
function drawParticles(ctx) {
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.life += 0.011;
    p.r    += p.speed;

    const fade = Math.min(1, p.life * 5) * Math.max(0, 1 - p.r / p.maxR) ** 1.5;
    if (fade < 0.008) { _particles.splice(i, 1); continue; }

    const lT      = p.r * 0.013;
    const lX      = Math.sin(p.lA * lT + p.lPhase);
    const lY      = Math.sin(p.lB * lT);
    const perturb = Math.atan2(lY, lX) * 0.40 * (1 - p.r / p.maxR) * p.wind;
    const effA    = p.angle + perturb;

    const px = _cx + p.r * Math.cos(effA);
    const py = _cy + p.r * Math.sin(effA);

    ctx.beginPath();
    ctx.arc(px, py, p.size, 0, Math.PI * 2);
    ctx.fillStyle = hsl(p.hue, 100, 88, fade * 0.95);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(px, py, p.size * 3.2, 0, Math.PI * 2);
    ctx.fillStyle = hsl(p.hue, 100, 72, fade * 0.16);
    ctx.fill();
  }
}

// ── Layer 5 — Atomic model with ฉัพพรรณรังสี colors ─────────────────────────
// 3 orbital ellipses (3D-tilted, projected to 2D) spin tempo-synced.
// Colors: orbits = นีลเขียว / มัญเชฐแสด / ปีตเหลือง
//         nucleus glow = ประภัสสร + โอทาตขาว
//         rim lobes = cycle all 6 ฉัพพรรณรังสี
function drawStar(ctx, bands, t) {
  const bass  = bands.bass * 0.52 + bands.subBass * 0.48;
  const pulse = 1 + bass * 0.38;
  const cR    = _r0 * 0.62 * pulse;
  const baseO = cR * 4.2;

  // ── 3 orbital planes — each colored by one ฉัพพรรณรังสี ──────────────────
  const ORBITS = [
    { a: baseO * 0.92, tilt: 0.18, sRot: 0,               spd: 2.00, col: C_NIL, band: bands.mid,      ne: 2 },
    { a: baseO * 1.08, tilt: 1.22, sRot:  Math.PI * 0.38,  spd: 1.35, col: C_MAN, band: bands.highMid,  ne: 1 },
    { a: baseO * 0.80, tilt: 0.68, sRot: -Math.PI * 0.52,  spd: 1.75, col: C_PIT, band: bands.presence, ne: 1 },
  ];

  ORBITS.forEach((o) => {
    const b      = o.a * Math.abs(Math.cos(o.tilt));
    const rot    = o.sRot + _rotAngle * o.spd * 0.14;
    const eAlpha = 0.80 + o.band * 0.20 + _beatFlash * 0.18;
    const orbA   = 0.18 + o.band * 0.38 + _beatFlash * 0.14;
    const lc     = lighten(o.col, 0.40);   // lighter tint for core dot

    // Orbit ring — outer glow pass + sharp line
    [3, 0].forEach(glowE => {
      ctx.save();
      ctx.translate(_cx, _cy);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, o.a + glowE * 4, b + glowE * 1.5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = glowE ? cc(...lc, orbA * 0.18) : cc(...o.col, orbA);
      ctx.lineWidth   = glowE ? (1.2 + o.band * 2) * 4 : 1.0 + o.band * 2;
      ctx.stroke();
      ctx.restore();
    });

    // Electrons
    for (let e = 0; e < o.ne; e++) {
      const theta = _rotAngle * o.spd + (e / o.ne) * Math.PI * 2;

      const ePos = (ang) => {
        const ex0 = o.a * Math.cos(ang);
        const ey0 = b   * Math.sin(ang);
        return {
          x: _cx + ex0 * Math.cos(rot) - ey0 * Math.sin(rot),
          y: _cy + ex0 * Math.sin(rot) + ey0 * Math.cos(rot),
        };
      };

      const eR = 3.5 + o.band * 5 + _beatFlash * 3;

      // Trail — 5 ghost dots fading behind
      for (let tr = 5; tr >= 1; tr--) {
        const p    = ePos(theta - tr * 0.16);
        const fade = (1 - tr / 6) * 0.30 * eAlpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, eR * (1 - tr * 0.15), 0, Math.PI * 2);
        ctx.fillStyle = cc(...o.col, fade);
        ctx.fill();
      }

      // Electron core (light tint = bright highlight)
      const ep = ePos(theta);
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, eR, 0, Math.PI * 2);
      ctx.fillStyle = cc(...lc, eAlpha);
      ctx.fill();

      // Electron glow halo
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, eR * 3.2, 0, Math.PI * 2);
      ctx.fillStyle = cc(...o.col, eAlpha * 0.22);
      ctx.fill();
    }
  });

  // ── Nucleus ambient glow — ประภัสสรเลื่อมพราย (crystal radiance) ──────────
  const nuclR = cR * (2.8 + _beatFlash * 1.8 + bands.overall * 0.8);
  const ng    = ctx.createRadialGradient(_cx, _cy, 0, _cx, _cy, nuclR);
  ng.addColorStop(0,   cc(...C_OTH, 0.55 + _beatFlash * 0.35));
  ng.addColorStop(0.3, cc(...C_PRA, 0.25 + _beatFlash * 0.12));
  ng.addColorStop(0.7, cc(...C_PRA, 0.07));
  ng.addColorStop(1,   cc(...C_PRA, 0));
  ctx.beginPath();
  ctx.arc(_cx, _cy, nuclR, 0, Math.PI * 2);
  ctx.fillStyle = ng;
  ctx.fill();

  // ── Hot nucleus core — โอทาตขาว/เงิน center → ประภัสสร edge ─────────────
  const coreG = ctx.createRadialGradient(_cx, _cy, 0, _cx, _cy, cR);
  coreG.addColorStop(0.00, cc(255, 255, 255, 1.00));   // pure white
  coreG.addColorStop(0.30, cc(...C_OTH,     0.97));    // โอทาตขาว (silver)
  coreG.addColorStop(0.60, cc(208, 220, 236, 0.90));   // cool silver-blue
  coreG.addColorStop(0.82, cc(...C_PRA,     0.68));    // ประภัสสร (crystal)
  coreG.addColorStop(1.00, cc(...C_PRA,     0));
  ctx.beginPath();
  ctx.arc(_cx, _cy, cR, 0, Math.PI * 2);
  ctx.fillStyle = coreG;
  ctx.fill();

  // // ── Rim lobes — 18 lobes cycling through all 6 ฉัพพรรณรังสี (×3 rounds) ──
  // const LOBES = 18;
  // for (let i = 0; i < LOBES; i++) {
  //   const [r, g, b] = CHAP6[i % 6];
  //   const θ  = (i / LOBES) * Math.PI * 2 + _rotAngle * 3.0 + t * 0.007;
  //   const lx = _cx + Math.cos(θ) * cR * 0.88;
  //   const ly = _cy + Math.sin(θ) * cR * 0.88;
  //   ctx.beginPath();
  //   ctx.arc(lx, ly, cR * 0.13, 0, Math.PI * 2);
  //   ctx.fillStyle = cc(r, g, b, 0.48 + _beatFlash * 0.30);
  //   ctx.fill();
  // }
}

// ── Main render ───────────────────────────────────────────────────────────────
export function renderPrismaticCollision(ctx, w, h, t, bands) {
  if (!_initialized || w !== _w || h !== _h) init(w, h);

  // ── Δt — capped to avoid jump on first frame or tab switch ────────────────
  const dt = _prevT > 0 ? Math.min(50, t - _prevT) : 16;
  _prevT = t;

  // ── Background — persistent fade ─────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,4,0.20)';
  ctx.fillRect(0, 0, w, h);

  // ── Beat detection ────────────────────────────────────────────────────────
  const rawBeat   = bands.subBass * 0.55 + bands.bass * 0.45;
  _beatSmooth    += (rawBeat - _beatSmooth) * 0.10;
  const beatPulse = Math.max(0, rawBeat - _beatSmooth * 0.80);
  const isBeat    = beatPulse > 0.06;

  // ── Tempo update + beat effect triggers ──────────────────────────────────
  updateTempo(t, isBeat, beatPulse);

  // ── Tempo-synced rotation: Δθ per frame = (2π/32beats)·(dt/interval) ─────
  _rotAngle += (Math.PI * 2 / BEATS_PER_REV) * (dt / _beatInterval);

  // ── Decay per-frame transients ────────────────────────────────────────────
  _kickOffset *= 0.880;   // ring kick springs back (spring constant ~0.12)
  _beatFlash  *= 0.875;   // corona flash fades
  _qPhase     += 0.48 + bands.overall * 1.90;   // colour cycling

  // ── Draw layers (back → front) ────────────────────────────────────────────
  drawFoam(ctx, bands, w, h);               // 0. quantum vacuum noise
  //drawBeams(ctx, bands, t, w, h);           // 1. spectral emission beams
  // BAND_KEYS.forEach((key, n) => {           // 2. QHO spectral rings ×7
  //  drawQuantumRing(ctx, n, bands[key], t, w, h);
  // });
  drawBeatRipples(ctx);                     // 3. beat shockwave ripples
  drawParticles(ctx);                       // 4. Lissajous photon particles
  //drawStar(ctx, bands, t);                  // 5. atom: nucleus + 3 orbitals

  // ── Particle spawning — boosted near beat onset (φ < 0.15) ───────────────
  const nearBeat = Math.max(1, 3 * Math.max(0, 1 - _beatPhase * 7));
  BAND_KEYS.forEach((key, n) => {
    const e = bands[key];
    if (e > 0.07 && Math.random() < e * 0.38 * nearBeat) spawnParticle(n, e);
  });

  // ── Beat-sync screen pulse (full-screen glint on strong beats) ───────────
  if (isBeat && beatPulse > 0.09) {
    ctx.fillStyle = `rgba(255,255,255,${beatPulse * 0.040})`;
    ctx.fillRect(0, 0, w, h);
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────
export function resetPrismaticCollision() {
  _initialized = false;
  _particles   = [];
  _beatRipples = [];
  _beatSmooth  = 0;
  _beatHistory = [];
  _beatInterval = 600;
  _lastBeatT   = 0;
  _beatPhase   = 0;
  _kickOffset  = 0;
  _beatFlash   = 0;
  _rotAngle    = 0;
  _prevT       = 0;
  _qPhase      = 0;
} 