// ─── RADIAL SPECTRUM — twin rings of light that shiver like sand on a woofer ──
//   Two concentric rings of fine radial ticks frame a centre point. Every bit
//   of motion — tick length, the granular jitter, the ring's breathing, the
//   outward bloom, the dust blown radially outward — is driven by the bass
//   envelope alone, the way sand poured onto a subwoofer only answers to the
//   low end, not the whole mix.

const TAU = Math.PI * 2;

let _config = {
  cx: 0.5, cy: 0.45,     // centre, as a fraction of the frame
  radius: 0.20,          // ring radius, as a fraction of the min dimension
  gapDeg: 70,            // opening at the bottom, in degrees (0 = closed ring)
  ticks: 110,            // ticks per ring
  jitter: 1.0,           // granular vibration strength
  tickLength: 1.0,       // scales how long/short the radial ticks are
  dust: 1.0,             // dust emission
  bloom: 0.8,            // outward bass ripple intensity (0 = off)
  bloomGap: 0.15,        // where the ripples start, out from the ray tips, as a fraction of the min dimension
  bloomSpread: 1.0,      // how far they travel before fading out
  bloomSize: 1.0,        // overall scale of the ripple field
  bloomRings: 9,         // how many concentric ripples are in flight at once
  bloomArcDeg: 60,       // gap at the top and bottom, in degrees (0 = unbroken circles)
  color: "#ffffff",
  colorMode: "gradient", // "gradient" (single hue) | "colorful" (hue around the ring)
  opacity: 1.0,
};

let _bass    = 0;      // smoothed bass
let _bassRef = 0;      // slow follower — the gap between them is the kick
let _ripple  = 0;      // 0..1 travel phase of the outward ripples
let _dust    = [];
let _sprite  = null;
let _lastT   = 0;
let _scratch = null, _scratchCtx = null;   // used to cap fill on very large frames

export function setRadialConfig(cfg) { Object.assign(_config, cfg); }
export function getRadialConfig()    { return { ..._config }; }
export function resetRadialSpectrum() {
  _bass = 0; _bassRef = 0; _ripple = 0; _dust = []; _lastT = 0;
}

/* ── colour ─────────────────────────────────────────────────────────────── */
function hexToHsl(hex) {
  hex = (hex || "#ffffff").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16) / 255,
        g = parseInt(hex.slice(2, 4), 16) / 255,
        b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
const hsla = (h, s, l, a) => `hsla(${h},${s}%,${l}%,${a})`;

/* cheap deterministic hash noise — the grain has to be per-tick and jumpy,
   not smooth, or it reads as a wobble instead of skittering sand */
function grain(i, t) {
  const x = Math.sin(i * 127.1 + t * 7.13) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function buildSprite() {
  if (_sprite) return;
  const S = 32, c = S / 2;
  const oc = new OffscreenCanvas(S, S);
  const g2 = oc.getContext("2d");
  const g = g2.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0,    "rgba(255,255,255,1)");
  g.addColorStop(0.3,  "rgba(255,255,255,0.5)");
  g.addColorStop(1,    "rgba(255,255,255,0)");
  g2.fillStyle = g;
  g2.beginPath(); g2.arc(c, c, c, 0, TAU); g2.fill();
  _sprite = oc;
}

/* The old lens-flare halo (a baked sprite with chromatic dispersion and a
   specular glint) is gone — the bloom below replaces it with a plain outward
   fade of the picked colour, which reads as bass pressure leaving the cone
   rather than as light through glass. It needs no sprite: one radial gradient
   fill per frame, in exactly the hue/saturation the ticks use. */

/* ── main render ────────────────────────────────────────────────────────── */
export function renderRadialSpectrum(ctx, w, h, t, bands) {
  if (!bands || !bands.frequency) return;   // no analyser data yet
  buildSprite();

  let dt = t - _lastT; _lastT = t;
  if (!(dt > 0) || dt > 100) dt = 16;

  const bass = (bands.bass || 0) * 0.6 + (bands.subBass || 0) * 0.4;
  _bass    += (bass - _bass) * 0.35;
  _bassRef += (bass - _bassRef) * 0.045;
  const kick    = Math.max(0, _bass - _bassRef);       // the thump, 0..~0.5
  const bassMag = Math.min(1, Math.pow(_bass, 0.78));  // bass envelope, perceptually lifted — the single driver behind every tick's length

  const time     = t * 0.001;
  const op       = _config.opacity;
  const colorful = _config.colorMode === "colorful";
  const [bh, bs] = hexToHsl(_config.color);
  const minDim   = Math.min(w, h);
  const scale    = w / 1280;

  const cx = _config.cx * w, cy = _config.cy * h;
  // the whole ring breathes with the bass, and punches out on the kick
  const rBase = _config.radius * minDim * (1 + _bass * 0.10 + kick * 0.35);

  const gapRad = (Math.min(340, Math.max(0, _config.gapDeg)) * Math.PI) / 180;
  const span   = TAU - gapRad;
  const start  = -Math.PI / 2 - span / 2;              // opening centred at the bottom
  const N      = Math.max(24, Math.round(_config.ticks));

  const jit    = _config.jitter;
  const lenMul = _config.tickLength;

  // Hundreds of radial strokes whose width scales with the frame is pure fill,
  // so past ~2200px draw into a downscaled scratch and composite up. 2200px is
  // still finer than a full-res 1080p pass, so the ticks stay sharp.
  const rScale = Math.min(1, 2200 / Math.max(w, h));
  let target = ctx;
  if (rScale < 0.99) {
    const SW = Math.max(2, Math.round(w * rScale)), SH = Math.max(2, Math.round(h * rScale));
    if (!_scratch || _scratch.width !== SW || _scratch.height !== SH) {
      _scratch = new OffscreenCanvas(SW, SH);
      _scratchCtx = _scratch.getContext("2d");
    }
    target = _scratchCtx;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, SW, SH);
    target.setTransform(rScale, 0, 0, rScale, 0, 0);   // keep full-res coordinates
  }

  const outCtx = ctx;      // where the finished ring lands
  ctx = target;            // everything below draws into the scratch when scaled
  ctx.save();
  ctx.lineCap = "round";

  // Two concentric rings: the inner one dense and bright, the outer sparser and
  // softer, so they read as two layers rather than one thick band.
  const rings = [
    { r: rBase,        lenK: 0.34, wid: 1.5 * scale, alpha: 0.85, lum: 92, every: 1, seed: 0 },
    { r: rBase * 1.19, lenK: 0.26, wid: 1.1 * scale, alpha: 0.45, lum: 84, every: 1, seed: 500 },
  ];
  // where the outer ring's tips typically sit (its per-tick jitter/flick noise
  // averages out, so this is the deterministic part of its length) — the flare
  // measures its gap from here, so it tracks the rays as they grow/shrink with
  // the bass or with the tick-length slider instead of sitting at a fixed spot
  const outerTipRadius = rings[1].r + minDim * (0.012 + bassMag * rings[1].lenK * 0.5) * lenMul;

  for (const ring of rings) {
    ctx.beginPath();
    for (let i = 0; i < N; i += ring.every) {
      const p  = N > 1 ? i / (N - 1) : 0;
      const a  = start + p * span;
      const mag = bassMag;   // every tick answers to the same bass envelope

      // the sand: a hard, per-tick grain that only comes alive with the bass
      const gr = grain(i + ring.seed, Math.floor(time * 26)) * _bass * jit;
      const jumpy = grain(i * 3.7 + ring.seed, Math.floor(time * 13));
      const jump  = jumpy > 0.82 ? jumpy * kick * 2.4 * jit : 0;   // occasional flick

      const len = minDim * (0.012 + mag * ring.lenK * 0.5 + Math.abs(gr) * 0.05 + jump * 0.05) * lenMul;
      const r0  = ring.r + gr * minDim * 0.006;
      const r1  = r0 + len;
      const ca = Math.cos(a), sa = Math.sin(a);
      ctx.moveTo(cx + ca * r0, cy + sa * r0);
      ctx.lineTo(cx + ca * r1, cy + sa * r1);
    }
    ctx.lineWidth   = ring.wid;
    ctx.strokeStyle = colorful
      ? hsla((time * 20 + ring.seed * 0.1) % 360, 80, ring.lum - 20, op * ring.alpha)
      : hsla(bh, bs, ring.lum, op * ring.alpha);
    ctx.stroke();
  }

  /* ── bloom: concentric ripples travelling outward, like sound leaving the
     cone. Each ring is born at the ray tips (bloomGap out from them, so it
     tracks the rays as they grow/shrink), travels across bloomSpread, and
     fades in and out over that journey — so rings are always in flight at
     staggered distances. They emanate faster and brighter with the bass and
     surge on the kick. Broken into a left and a right arc with a gap top and
     bottom (bloomArcDeg), each arc tapered toward its ends by a vertical
     gradient so the lines dissolve rather than stopping dead. Unlike the ticks
     this does not follow gapDeg.                                            */
  const bloom = _config.bloom;
  if (bloom > 0.01) {
    // exactly the hue/saturation the ticks are using this frame
    const hueDeg = Math.round(colorful ? (time * 20) % 360 : bh);
    const satAct = Math.round(colorful ? 80 : bs);

    const r0   = (outerTipRadius + _config.bloomGap * minDim) * _config.bloomSize;
    const span = Math.max(minDim * 0.04, _config.bloomSpread * minDim * 0.42 * _config.bloomSize);
    const baseA = Math.min(1, op * bloom * (0.14 + _bass * 0.66 + kick * 0.62));

    // the ripples keep travelling outward; the bass drives how fast they go
    _ripple = (_ripple + (0.05 + _bass * 0.18 + kick * 0.55) * (dt / 1000)) % 1;

    const RN   = Math.max(2, Math.round(_config.bloomRings));
    const half = (Math.PI - (Math.min(170, Math.max(0, _config.bloomArcDeg)) * Math.PI) / 180) / 2;

    ctx.lineCap = "butt";
    for (let i = 0; i < RN; i++) {
      const u = ((i / RN) + _ripple) % 1;        // 0 = just born, 1 = spent
      const a = baseA * Math.sin(u * Math.PI);   // fade in and out across the journey
      if (a < 0.004) continue;
      const r = r0 + u * span;

      // taper both ends of each arc toward the top/bottom gap
      const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
      g.addColorStop(0,    hsla(hueDeg, satAct, 66, 0));
      g.addColorStop(0.24, hsla(hueDeg, satAct, 66, a));
      g.addColorStop(0.76, hsla(hueDeg, satAct, 66, a));
      g.addColorStop(1,    hsla(hueDeg, satAct, 66, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = Math.max(0.6, (1.9 - u * 1.1) * scale);   // thins as it spreads

      ctx.beginPath();
      ctx.arc(cx, cy, r, -half, half);                          // right side
      ctx.moveTo(cx + Math.cos(Math.PI - half) * r, cy + Math.sin(Math.PI - half) * r);
      ctx.arc(cx, cy, r, Math.PI - half, Math.PI + half);       // left side
      ctx.stroke();
    }
    ctx.lineCap = "round";
  }

  /* ── dust blown off the ring on every kick ── */
  const MAX_DUST = 220;
  const emit = _config.dust;
  if (emit > 0.01) {
    let n = (0.3 + kick * 90 * emit + _bass * 1.2 * emit) * (dt / 16);
    n = Math.floor(n) + (Math.random() < (n % 1) ? 1 : 0);
    for (let k = 0; k < n && _dust.length < MAX_DUST; k++) {
      const p = Math.random();
      const a = start + p * span + (Math.random() - 0.5) * 0.06;
      const r = rBase * (1.02 + Math.random() * 0.22);
      const sp = minDim * (0.05 + Math.random() * 0.16) * (0.4 + kick * 2.2);
      _dust.push({
        x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
        vx: Math.cos(a) * sp + (Math.random() - 0.5) * minDim * 0.02,
        vy: Math.sin(a) * sp + (Math.random() - 0.5) * minDim * 0.02,
        life: 600 + Math.random() * 900, maxLife: 0,
        size: (0.5 + Math.random() * 1.5) * scale,
        a0: 0.25 + Math.random() * 0.35,
        hue: colorful ? (a * 180 / Math.PI + time * 20 + 360) % 360 : bh,
      });
      _dust[_dust.length - 1].maxLife = _dust[_dust.length - 1].life;
    }
  }

  let wi = 0;
  for (let i = 0; i < _dust.length; i++) {
    const p = _dust[i];
    p.life -= dt;
    if (p.life <= 0) continue;
    const s = dt / 1000;
    p.x += p.vx * s; p.y += p.vy * s;
    p.vx *= 0.94; p.vy *= 0.94;                  // air drag: the puff stalls out
    const lf = p.life / p.maxLife;
    const al = Math.sin(lf * Math.PI) * p.a0 * op;
    if (al > 0.004) {
      const dim = p.size * (1 + (1 - lf) * 1.6) * 5;
      ctx.globalAlpha = al;
      ctx.drawImage(_sprite, p.x - dim / 2, p.y - dim / 2, dim, dim);
    }
    _dust[wi++] = p;
  }
  _dust.length = wi;
  ctx.globalAlpha = 1;

  ctx.restore();

  if (target !== outCtx) {
    outCtx.globalAlpha = 1;
    outCtx.drawImage(_scratch, 0, 0, w, h);
  }
}
