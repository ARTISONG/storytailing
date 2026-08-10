// ─── RADIAL SPECTRUM — twin rings of light that shiver like sand on a woofer ──
//   Two concentric rings of fine radial ticks frame a centre point. Their length
//   follows the spectrum, but the character comes from a granular jitter driven
//   by the bass — the way sand poured onto a subwoofer skitters and jumps — plus
//   dust blown radially outward on every kick.

const TAU = Math.PI * 2;

let _config = {
  cx: 0.5, cy: 0.45,     // centre, as a fraction of the frame
  radius: 0.20,          // ring radius, as a fraction of the min dimension
  gapDeg: 70,            // opening at the bottom, in degrees (0 = closed ring)
  ticks: 110,            // ticks per ring
  jitter: 1.0,           // granular vibration strength
  dust: 1.0,             // dust emission
  halo: 0.8,             // faint outer halo loop (0 = off)
  haloScale: 1.9,        // its radius, as a multiple of the ring radius
  color: "#ffffff",
  colorMode: "gradient", // "gradient" (single hue) | "colorful" (hue around the ring)
  opacity: 1.0,
};

const BINS = 48;
let _bars    = null;   // smoothed magnitudes, 0..1
let _bass    = 0;      // smoothed bass
let _bassRef = 0;      // slow follower — the gap between them is the kick
let _dust    = [];
let _sprite  = null;
let _lastT   = 0;
let _scratch = null, _scratchCtx = null;   // used to cap fill on very large frames

export function setRadialConfig(cfg) { Object.assign(_config, cfg); }
export function getRadialConfig()    { return { ..._config }; }
export function resetRadialSpectrum() {
  _bars = null; _bass = 0; _bassRef = 0; _dust = []; _lastT = 0;
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

/* ── lens-flare halo ring — baked once per colour, then just a drawImage ────
   A real lens-flare halo is dispersed light through glass: a torus-shaped
   band with a chromatic (rainbow-fringed) sweep and one bright specular hot
   spot, not an outline and not a wave. Baked at a fixed radius fraction
   (ring mid-band sits at 0.60 of the sprite's half-size — see FLARE_SF) so
   the caller only needs one multiply to know the draw size for a given
   target radius. */
const FLARE_MID_FRAC = 0.60;
const FLARE_SF = 1 / FLARE_MID_FRAC;      // draw diameter = hr * 2 * FLARE_SF
let _flareSprite = null, _flareKey = null;

function buildFlareSprite(colorful, hue, sat) {
  const key = colorful ? "colorful" : `${hue}:${sat}`;
  if (_flareKey === key) return;
  _flareKey = key;

  const S = 512, c = S / 2;
  const glintFrac = 0.14;                 // where the "sun hits the glass"
  const circDist = (a, b) => { let d = Math.abs(a - b) % 1; return d > 0.5 ? 1 - d : d; };

  // ring layer: conic hue sweep + specular hot spot, opaque (alpha shaped later)
  const ring = new OffscreenCanvas(S, S);
  const rc = ring.getContext("2d");
  const conic = rc.createConicGradient(-Math.PI / 2, c, c);
  const STOPS = 48;
  for (let i = 0; i <= STOPS; i++) {
    const frac = i / STOPS;
    const boost = Math.exp(-(circDist(frac, glintFrac) ** 2) / (2 * 0.05 * 0.05));
    const h = colorful
      ? (frac * 360) % 360
      : hue + Math.sin(frac * TAU * 2) * 16;                    // gentle dispersion wobble
    const s = Math.max(20, (colorful ? 80 : sat) * (1 - boost * 0.75));
    const l = 52 + boost * 44;                                   // whites-out at the glint
    conic.addColorStop(frac, hsla(Math.round(h), Math.round(s), Math.round(l), 1));
  }
  rc.fillStyle = conic;
  rc.fillRect(0, 0, S, S);

  // shape it into a torus — soft single peak at FLARE_MID_FRAC, transparent at
  // the centre and the far edge
  const mask = rc.createRadialGradient(c, c, 0, c, c, c);
  mask.addColorStop(0.00, "rgba(0,0,0,0)");
  mask.addColorStop(0.42, "rgba(0,0,0,0)");
  mask.addColorStop(0.50, "rgba(0,0,0,0.55)");
  mask.addColorStop(FLARE_MID_FRAC, "rgba(0,0,0,1)");
  mask.addColorStop(0.70, "rgba(0,0,0,0.55)");
  mask.addColorStop(0.80, "rgba(0,0,0,0)");
  mask.addColorStop(1.00, "rgba(0,0,0,0)");
  rc.globalCompositeOperation = "destination-in";
  rc.fillStyle = mask;
  rc.fillRect(0, 0, S, S);
  rc.globalCompositeOperation = "source-over";

  // final sprite: soften the ring with a blur pass, plus a faint ambient wash
  // behind it so the flare bleeds into the scene a little
  const final = new OffscreenCanvas(S, S);
  const fc = final.getContext("2d");
  // fades back to transparent at the sprite edge — a gradient stop at offset 1
  // clamps to that colour for anything beyond it, which was leaking a faint
  // square wash into the corners once drawn
  const amb = fc.createRadialGradient(c, c, S * 0.20, c, c, S * 0.5);
  amb.addColorStop(0,    "rgba(255,255,255,0)");
  amb.addColorStop(0.6,  colorful ? "rgba(180,200,255,0.06)" : hsla(hue, sat, 75, 0.07));
  amb.addColorStop(1,    "rgba(255,255,255,0)");
  fc.fillStyle = amb;
  fc.beginPath(); fc.arc(c, c, S * 0.5, 0, TAU); fc.fill();
  fc.filter = "blur(3px)";
  fc.drawImage(ring, 0, 0);
  fc.filter = "none";

  _flareSprite = final;
}

/* ── FFT → smoothed bins (log spaced) ───────────────────────────────────── */
function computeBars(freq) {
  if (!_bars) _bars = new Float32Array(BINS);
  const n = freq.length;
  const lo = 1, hi = Math.floor(n * 0.7), ratio = hi / lo;
  for (let i = 0; i < BINS; i++) {
    const f0 = Math.floor(lo * Math.pow(ratio, i / BINS));
    const f1 = Math.max(f0 + 1, Math.floor(lo * Math.pow(ratio, (i + 1) / BINS)));
    let s = 0, c = 0;
    for (let b = f0; b < f1 && b < n; b++) { s += freq[b]; c++; }
    let m = c ? (s / c) / 255 : 0;
    m *= 0.6 + 1.0 * (i / BINS);            // lift the naturally quieter highs
    m = Math.min(1, Math.pow(m, 0.82));
    const cur = _bars[i];
    _bars[i] = m > cur ? cur + (m - cur) * 0.55 : cur + (m - cur) * 0.16;
  }
}

/* ── main render ────────────────────────────────────────────────────────── */
export function renderRadialSpectrum(ctx, w, h, t, bands) {
  const freq = bands && bands.frequency;
  if (!freq) return;
  computeBars(freq);
  if (!_bars) return;
  buildSprite();

  let dt = t - _lastT; _lastT = t;
  if (!(dt > 0) || dt > 100) dt = 16;

  const bass = (bands.bass || 0) * 0.6 + (bands.subBass || 0) * 0.4;
  _bass    += (bass - _bass) * 0.35;
  _bassRef += (bass - _bassRef) * 0.045;
  const kick = Math.max(0, _bass - _bassRef);       // the thump, 0..~0.5

  const time     = t * 0.001;
  const op       = _config.opacity;
  const colorful = _config.colorMode === "colorful";
  const [bh, bs] = hexToHsl(_config.color);
  const minDim   = Math.min(w, h);
  const scale    = w / 1280;

  const cx = _config.cx * w, cy = _config.cy * h;
  // the whole ring breathes with the music, and punches out on the kick
  const rBase = _config.radius * minDim * (1 + (bands.overall || 0) * 0.10 + kick * 0.35);

  const gapRad = (Math.min(340, Math.max(0, _config.gapDeg)) * Math.PI) / 180;
  const span   = TAU - gapRad;
  const start  = -Math.PI / 2 - span / 2;              // opening centred at the bottom
  const N      = Math.max(24, Math.round(_config.ticks));

  const jit = _config.jitter;

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

  for (const ring of rings) {
    ctx.beginPath();
    for (let i = 0; i < N; i += ring.every) {
      const p  = N > 1 ? i / (N - 1) : 0;
      const a  = start + p * span;
      // mirror the spectrum around the top so the ring reads symmetrically
      const d  = Math.abs(p - 0.5) * 2;
      const bi = Math.min(BINS - 1, Math.floor(d * BINS));
      const mag = _bars[bi];

      // the sand: a hard, per-tick grain that only comes alive with the bass
      const gr = grain(i + ring.seed, Math.floor(time * 26)) * _bass * jit;
      const jumpy = grain(i * 3.7 + ring.seed, Math.floor(time * 13));
      const jump  = jumpy > 0.82 ? jumpy * kick * 2.4 * jit : 0;   // occasional flick

      const len = minDim * (0.012 + mag * ring.lenK * 0.5 + Math.abs(gr) * 0.05 + jump * 0.05);
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

  /* ── halo: a lens-flare ring — dispersed light, not a wave or an outline ──
     Baked once per colour (see buildFlareSprite); per frame it's just a
     drawImage, sized so the ring's bright band lands at hr, with a gentle
     size/brightness pulse tied to the music instead of any organic ripple —
     real flares don't wobble, they flare up in intensity.                    */
  const halo = _config.halo;
  if (halo > 0.01) {
    buildFlareSprite(colorful, bh, bs);
    if (_flareSprite) {
      const hr   = rBase * _config.haloScale;
      const pulse = 1 + (bands.overall || 0) * 0.05 + kick * 0.12;
      const dim   = hr * 2 * FLARE_SF * pulse;
      const a     = Math.min(1, op * halo * (0.55 + (bands.overall || 0) * 0.30 + kick * 0.35));
      ctx.globalAlpha = a;
      ctx.drawImage(_flareSprite, cx - dim / 2, cy - dim / 2, dim, dim);
      ctx.globalAlpha = 1;
    }
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
