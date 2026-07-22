// ─── BOKEH SPARKLE — elegant floating particles ───────────────────────────────
import { simplex } from "../utils/simplex.js";

const TAU = Math.PI * 2;

// Pre-baked 6-arm angles
const ARM6 = Array.from({length:6}, (_,i) => (i/6)*TAU - Math.PI/2);

/* ── Snow layers — 4 depth tiers ─────────────────────────────────────────── */
const SNOW_LAYERS = [
  { freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.22, sizeMin:0.0010, sizeMax:0.0025, speedMin:0.0010, speedMax:0.0018, countFrac:0.35, alphaBase:0.06, alphaFreq:0.09,  sprite:"dot",     swayAmp:0.00006, rotSpeed:0.000 },
  { freqKeys:["lowMid","mid"],       depthMin:0.22, depthMax:0.50, sizeMin:0.0025, sizeMax:0.0065, speedMin:0.0020, speedMax:0.0034, countFrac:0.30, alphaBase:0.12, alphaFreq:0.16,  sprite:"simple",  swayAmp:0.00018, rotSpeed:0.0008 },
  { freqKeys:["highMid","presence"], depthMin:0.50, depthMax:0.78, sizeMin:0.0065, sizeMax:0.0160, speedMin:0.0038, speedMax:0.0058, countFrac:0.22, alphaBase:0.22, alphaFreq:0.24,  sprite:"crystal", swayAmp:0.00035, rotSpeed:0.0016 },
  { freqKeys:["brilliance"],         depthMin:0.78, depthMax:1.00, sizeMin:0.0160, sizeMax:0.0360, speedMin:0.0060, speedMax:0.0100, countFrac:0.13, alphaBase:0.38, alphaFreq:0.34,  sprite:"flake",   swayAmp:0.00060, rotSpeed:0.0030 },
];

/* ── Generic layers (circle / hexagon) ───────────────────────────────────── */
const LAYER_DEFS = [
  { freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.25, sizeMin:0.016, sizeMax:0.038, countFrac:0.18, alphaBase:0.10, alphaFreq:0.16, rotSpeed:0.0004 },
  { freqKeys:["lowMid","mid"],       depthMin:0.20, depthMax:0.50, sizeMin:0.008, sizeMax:0.022, countFrac:0.30, alphaBase:0.14, alphaFreq:0.20, rotSpeed:0.0008 },
  { freqKeys:["highMid","presence"], depthMin:0.45, depthMax:0.75, sizeMin:0.004, sizeMax:0.013, countFrac:0.30, alphaBase:0.18, alphaFreq:0.24, rotSpeed:0.0012 },
  { freqKeys:["brilliance"],         depthMin:0.70, depthMax:1.00, sizeMin:0.002, sizeMax:0.008, countFrac:0.22, alphaBase:0.22, alphaFreq:0.30, rotSpeed:0.0018 },
];

/* ── Rain layers — 4 depth tiers of motion-blurred streaks ────────────────────
   Far tiers: thin, faint, short, slow. Near tiers: thick, bright, long, fast
   with a defocused foreground halo. `speed`/`length` are fractions of height,
   `thick` a fraction of the min dimension.                                    */
const RAIN_LAYERS = [
  { freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.30, countFrac:0.36, lenMin:0.020, lenMax:0.040, thickMin:0.0006, thickMax:0.0011, speedMin:0.020, speedMax:0.030, alphaBase:0.05, alphaFreq:0.05 },
  { freqKeys:["lowMid","mid"],       depthMin:0.30, depthMax:0.58, countFrac:0.30, lenMin:0.038, lenMax:0.065, thickMin:0.0011, thickMax:0.0018, speedMin:0.030, speedMax:0.044, alphaBase:0.08, alphaFreq:0.08 },
  { freqKeys:["highMid","presence"], depthMin:0.58, depthMax:0.82, countFrac:0.22, lenMin:0.060, lenMax:0.100, thickMin:0.0018, thickMax:0.0030, speedMin:0.044, speedMax:0.064, alphaBase:0.13, alphaFreq:0.12 },
  { freqKeys:["brilliance"],         depthMin:0.82, depthMax:1.00, countFrac:0.12, lenMin:0.095, lenMax:0.150, thickMin:0.0030, thickMax:0.0050, speedMin:0.064, speedMax:0.092, alphaBase:0.18, alphaFreq:0.16 },
];

/* ── Golden-dust layers — soft bokeh discs + fine sparkle glitter ─────────────
   `role:"bokeh"` = big defocused warm discs (far tiers biggest & softest);
   `role:"glitter"` = tiny sharp golden specks that twinkle & flare on beats.
   `sizeMin/Max` are fractions of the min dimension, `drift` of the height.    */
const GOLD_LAYERS = [
  { role:"bokeh",   freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.28, countFrac:0.16, sizeMin:0.055, sizeMax:0.120, driftMin:0.00016, driftMax:0.00040, alphaBase:0.05, alphaFreq:0.05 },
  { role:"bokeh",   freqKeys:["lowMid","mid"],       depthMin:0.28, depthMax:0.55, countFrac:0.22, sizeMin:0.030, sizeMax:0.072, driftMin:0.00022, driftMax:0.00052, alphaBase:0.08, alphaFreq:0.09 },
  { role:"bokeh",   freqKeys:["highMid","presence"], depthMin:0.55, depthMax:0.80, countFrac:0.24, sizeMin:0.015, sizeMax:0.042, driftMin:0.00030, driftMax:0.00070, alphaBase:0.12, alphaFreq:0.14 },
  { role:"glitter", freqKeys:["brilliance"],         depthMin:0.80, depthMax:1.00, countFrac:0.38, sizeMin:0.004, sizeMax:0.013, driftMin:0.00040, driftMax:0.00100, alphaBase:0.16, alphaFreq:0.28 },
];

/* ── Sprite cache — built once, reused every frame ───────────────────────── */
const SPRITE_SIZE = 256;           // px
const _sprites = {};               // { dot, simple, crystal, flake }

function buildSprites() {
  if (_sprites.dot) return;        // already built

  const S  = SPRITE_SIZE;
  const cx = S / 2, cy = S / 2;
  const r  = S * 0.40;            // arm radius
  const lw = S * 0.030;           // base line width

  /* ── dot: blurry soft disc with faint hex ring ──────────────────────── */
  {
    const oc = new OffscreenCanvas(S, S);
    const c  = oc.getContext("2d");
    c.translate(cx, cy);
    // Soft gaussian-like falloff: 3 overlapping fills
    [[r*1.8, 0.06],[r*1.1, 0.25],[r*0.45, 0.70]].forEach(([rad, a]) => {
      c.beginPath(); c.arc(0,0,rad,0,TAU);
      c.fillStyle=`rgba(255,255,255,${a})`; c.fill();
    });
    _sprites.dot = oc;
  }

  /* ── simple: 6 clean arms, no branches — pure asterisk ─────────────── */
  {
    const oc = new OffscreenCanvas(S, S);
    const c  = oc.getContext("2d");
    c.translate(cx, cy);
    c.lineCap = "round";
    // glow pass
    c.strokeStyle = "rgba(255,255,255,0.18)";
    c.lineWidth   = lw * 4;
    c.beginPath();
    ARM6.forEach(a => { c.moveTo(0,0); c.lineTo(Math.cos(a)*r, Math.sin(a)*r); });
    c.stroke();
    // crisp pass
    c.strokeStyle = "rgba(255,255,255,0.92)";
    c.lineWidth   = lw * 0.9;
    c.stroke();
    // center dot
    c.beginPath(); c.arc(0,0,lw*1.4,0,TAU);
    c.fillStyle="white"; c.fill();
    _sprites.simple = oc;
  }

  /* ── crystal: 6 arms + one branch level (×2 per arm) ───────────────── */
  {
    const oc = new OffscreenCanvas(S, S);
    const c  = oc.getContext("2d");
    c.translate(cx, cy);
    c.lineCap = "round";

    const buildPath = () => {
      c.beginPath();
      ARM6.forEach(a => {
        const ca=Math.cos(a), sa=Math.sin(a);
        c.moveTo(0,0); c.lineTo(ca*r, sa*r);
        // one branch pair at 55% length
        const bx=ca*r*0.55, by=sa*r*0.55, bl=r*0.36;
        for (const s of [-1,1]) {
          const ba=a+s*0.70;
          c.moveTo(bx,by); c.lineTo(bx+Math.cos(ba)*bl, by+Math.sin(ba)*bl);
        }
      });
    };
    // glow pass
    c.strokeStyle="rgba(255,255,255,0.15)"; c.lineWidth=lw*4; buildPath(); c.stroke();
    // crisp pass
    c.strokeStyle="rgba(255,255,255,0.95)"; c.lineWidth=lw; buildPath(); c.stroke();
    // center hex
    c.beginPath();
    for(let i=0;i<6;i++){const a=(i/6)*TAU,cr=lw*2.2;i===0?c.moveTo(Math.cos(a)*cr,Math.sin(a)*cr):c.lineTo(Math.cos(a)*cr,Math.sin(a)*cr);}
    c.closePath(); c.fillStyle="white"; c.fill();
    _sprites.crystal = oc;
  }

  /* ── flake: 6 arms + two branch levels — full dendrite ─────────────── */
  {
    const oc = new OffscreenCanvas(S, S);
    const c  = oc.getContext("2d");
    c.translate(cx, cy);
    c.lineCap = "round";

    const buildPath = () => {
      c.beginPath();
      ARM6.forEach(a => {
        const ca=Math.cos(a), sa=Math.sin(a);
        c.moveTo(0,0); c.lineTo(ca*r, sa*r);
        // outer branches at 62%
        const b1x=ca*r*0.62, b1y=sa*r*0.62, b1l=r*0.36;
        for (const s of [-1,1]) {
          const ba=a+s*0.72;
          c.moveTo(b1x,b1y); c.lineTo(b1x+Math.cos(ba)*b1l, b1y+Math.sin(ba)*b1l);
        }
        // inner branches at 32%
        const b2x=ca*r*0.32, b2y=sa*r*0.32, b2l=r*0.22;
        for (const s of [-1,1]) {
          const ba=a+s*0.68;
          c.moveTo(b2x,b2y); c.lineTo(b2x+Math.cos(ba)*b2l, b2y+Math.sin(ba)*b2l);
        }
      });
    };

    // outer soft aura
    c.beginPath(); c.arc(0,0,r*1.9,0,TAU);
    c.fillStyle="rgba(255,255,255,0.04)"; c.fill();
    c.beginPath(); c.arc(0,0,r*1.2,0,TAU);
    c.fillStyle="rgba(255,255,255,0.08)"; c.fill();
    // glow pass
    c.strokeStyle="rgba(255,255,255,0.14)"; c.lineWidth=lw*4.5; buildPath(); c.stroke();
    // crisp pass
    c.strokeStyle="rgba(255,255,255,0.96)"; c.lineWidth=lw*1.1; buildPath(); c.stroke();
    // center hexagon core
    const cr=lw*3;
    c.beginPath();
    for(let i=0;i<6;i++){const a=(i/6)*TAU;i===0?c.moveTo(Math.cos(a)*cr,Math.sin(a)*cr):c.lineTo(Math.cos(a)*cr,Math.sin(a)*cr);}
    c.closePath(); c.fillStyle="white"; c.fill();
    _sprites.flake = oc;
  }
}

/* ── Sunset dust sprites — warm golden motes, pre-baked hue variants ────────
   Gradients are expensive per-frame; baking them into sprites keeps the
   dust mode as cheap as the snowflake sprite system.                        */
const DUST_VARIANTS = 5;
function buildDustSprites() {
  if (_sprites.dust) return;
  const S = 160, cx = S/2, R = S*0.48;
  const sprites = [];
  for (let v = 0; v < DUST_VARIANTS; v++) {
    const hue = (v/(DUST_VARIANTS-1) - 0.5) * 28;      // -14 … +14 hue drift
    const oc = new OffscreenCanvas(S, S);
    const c  = oc.getContext("2d");
    const cG = Math.round(238 + hue*0.3), cB = Math.round(205 + hue);
    const mB = Math.round(120 + hue*1.6);
    const g  = c.createRadialGradient(cx,cx,0, cx,cx,R);
    g.addColorStop(0,   `rgba(255,${cG},${cB},0.92)`);   // warm white core
    g.addColorStop(0.35,`rgba(255,205,${mB},0.55)`);     // golden body
    g.addColorStop(0.72,`rgba(255,166,120,0.20)`);       // peach falloff
    g.addColorStop(1,   `rgba(255,140,150,0)`);          // rose fade-out
    c.fillStyle = g;
    c.beginPath(); c.arc(cx,cx,R,0,TAU); c.fill();
    sprites.push(oc);
  }
  _sprites.dust = sprites;

  // 4-point star glint for the sparkly "✦" flash on bright near motes
  {
    const oc = new OffscreenCanvas(S, S);
    const c  = oc.getContext("2d");
    c.translate(cx, cx);
    const arm = S*0.46;
    c.lineCap = "round";
    for (const pass of [[S*0.030, 0.35], [S*0.012, 0.95]]) {
      c.strokeStyle = `rgba(255,248,225,${pass[1]})`;
      c.lineWidth   = pass[0];
      c.beginPath();
      for (let i=0;i<4;i++){ const a=i*Math.PI/2; c.moveTo(0,0); c.lineTo(Math.cos(a)*arm, Math.sin(a)*arm); }
      c.stroke();
    }
    const g = c.createRadialGradient(0,0,0, 0,0,S*0.14);
    g.addColorStop(0,"rgba(255,255,245,0.95)"); g.addColorStop(1,"rgba(255,255,245,0)");
    c.fillStyle=g; c.beginPath(); c.arc(0,0,S*0.14,0,TAU); c.fill();
    _sprites.glint = oc;
  }
}

/* ── Bubble sprite — soap-bubble / water-droplet look ────────────────────────
   Built with a dark outer edge + bright rim + iridescent arcs + specular
   highlights so it stays readable on bright, colorful backgrounds
   (rendered with source-over, not screen).                                  */
function buildBubbleSprite() {
  if (_sprites.bubble) return;
  const S  = SPRITE_SIZE;
  const cx = S/2, cy = S/2;
  const R  = S*0.42;               // bubble radius (margin for glow)
  const oc = new OffscreenCanvas(S, S);
  const c  = oc.getContext("2d");
  c.translate(cx, cy);

  // 1. Faint interior — edge slightly denser than center (thin-film shell)
  {
    const g = c.createRadialGradient(0,0,R*0.55, 0,0,R);
    g.addColorStop(0,    "rgba(255,255,255,0.00)");
    g.addColorStop(0.75, "rgba(255,255,255,0.05)");
    g.addColorStop(1,    "rgba(255,255,255,0.16)");
    c.fillStyle = g;
    c.beginPath(); c.arc(0,0,R,0,TAU); c.fill();
  }

  // 2. Dark occlusion ring just outside the rim — the trick that keeps the
  //    bubble visible on white / bright backgrounds
  c.lineCap = "round";
  c.strokeStyle = "rgba(8,22,42,0.55)";
  c.lineWidth   = S*0.030;
  c.beginPath(); c.arc(0,0,R*1.02,0,TAU); c.stroke();

  // 3. Bright rim — full circle
  c.strokeStyle = "rgba(255,255,255,0.95)";
  c.lineWidth   = S*0.020;
  c.beginPath(); c.arc(0,0,R*0.965,0,TAU); c.stroke();

  // 4. Iridescent arcs hugging the rim (thin-film interference colours)
  const arcs = [
    { from: 0.15*TAU, to: 0.45*TAU, color: "rgba(90,205,255,0.85)"  },  // cyan lower-left
    { from: 0.52*TAU, to: 0.74*TAU, color: "rgba(255,140,200,0.80)" },  // pink upper-right
    { from: 0.78*TAU, to: 0.95*TAU, color: "rgba(255,210,110,0.75)" },  // gold upper
  ];
  for (const a of arcs) {
    c.strokeStyle = a.color;
    c.lineWidth   = S*0.045;
    c.beginPath(); c.arc(0,0,R*0.91, a.from, a.to); c.stroke();
  }

  // 5. Specular highlights — main (upper-left) + tiny counter (lower-right)
  {
    const hx=-R*0.42, hy=-R*0.46;
    const g = c.createRadialGradient(hx,hy,0, hx,hy,R*0.30);
    g.addColorStop(0,   "rgba(255,255,255,0.95)");
    g.addColorStop(0.4, "rgba(255,255,255,0.45)");
    g.addColorStop(1,   "rgba(255,255,255,0)");
    c.fillStyle=g; c.beginPath(); c.ellipse(hx,hy,R*0.26,R*0.16,-Math.PI/4,0,TAU); c.fill();
    // counter-highlight
    c.fillStyle="rgba(255,255,255,0.35)";
    c.beginPath(); c.ellipse(R*0.38,R*0.44,R*0.09,R*0.05,-Math.PI/4,0,TAU); c.fill();
  }
  _sprites.bubble = oc;
}

/* ── Rain streak sprite — soft vertical motion-blur bar ──────────────────────
   Baked once so the per-frame path is a single drawImage per drop (no
   per-frame gradients). Transparent at the top (tail) → bright at the bottom
   (leading head). A wide faint halo under a crisp core gives soft edges.     */
function buildRainSprite() {
  if (_sprites.rain) return;
  const W = 64, H = 256;
  const oc = new OffscreenCanvas(W, H);
  const c  = oc.getContext("2d");
  const grad = (a) => {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0,    "rgba(206,228,255,0)");            // tail — fades out
    g.addColorStop(0.5,  `rgba(206,228,255,${0.06 * a})`);
    g.addColorStop(0.85, `rgba(222,238,255,${0.55 * a})`);
    g.addColorStop(1,    `rgba(242,249,255,${0.95 * a})`);  // head — bright
    return g;
  };
  // wide, faint halo → soft horizontal falloff
  c.fillStyle = grad(0.4);
  const bw1 = W * 0.5;  c.fillRect((W - bw1) / 2, 0, bw1, H);
  // crisp bright core
  c.fillStyle = grad(1);
  const bw2 = W * 0.18; c.fillRect((W - bw2) / 2, 0, bw2, H);
  _sprites.rain = oc;
}

/* ── Golden-dust sprites — bokeh discs (rim-lit) + 4-point glitter glint ──────
   Bokeh discs get a brighter rim (classic photographic bokeh "donut") with a
   soft edge, baked in a few warm-gold hue variants. The glint is a golden star
   used for the sparkle flashes on the fine glitter layer.                     */
const GOLD_VARIANTS = 5;
function buildGoldSprites() {
  if (_sprites.goldBokeh) return;

  const S = 192, cc = S/2, R = S*0.46;
  const bokeh = [];
  for (let v = 0; v < GOLD_VARIANTS; v++) {
    const hue = v/(GOLD_VARIANTS-1) - 0.5;                 // -0.5 … 0.5
    const gC  = Math.round(206 + hue*28);                  // 192 … 220 (green chan)
    const bC  = Math.round(120 + hue*70);                  //  85 … 155 (blue  chan)
    const oc  = new OffscreenCanvas(S, S);
    const c   = oc.getContext("2d");
    const g   = c.createRadialGradient(cc, cc, 0, cc, cc, R);
    g.addColorStop(0,    `rgba(255,${gC},${bC},0.26)`);    // soft warm center
    g.addColorStop(0.55, `rgba(255,${gC},${bC},0.34)`);
    g.addColorStop(0.83, `rgba(255,${Math.min(255,gC+22)},${bC},0.62)`); // bright rim
    g.addColorStop(0.94, `rgba(255,${gC},${bC},0.30)`);
    g.addColorStop(1,    `rgba(255,${gC},${bC},0)`);       // soft edge fade
    c.fillStyle = g;
    c.beginPath(); c.arc(cc, cc, R, 0, TAU); c.fill();
    bokeh.push(oc);
  }
  _sprites.goldBokeh = bokeh;

  // soft warm glow for the glitter twinkle — a round bloom, no hard star arms
  // (a hot near-white core fading through gold to a soft edge → natural spark)
  {
    const S2 = 128, c0 = S2/2;
    const oc = new OffscreenCanvas(S2, S2);
    const c  = oc.getContext("2d");
    const g  = c.createRadialGradient(c0, c0, 0, c0, c0, S2*0.5);
    g.addColorStop(0,    "rgba(255,250,226,0.98)");   // hot near-white core
    g.addColorStop(0.16, "rgba(255,240,190,0.72)");
    g.addColorStop(0.42, "rgba(255,214,134,0.26)");   // warm gold falloff
    g.addColorStop(1,    "rgba(255,198,118,0)");      // soft edge
    c.fillStyle = g;
    c.beginPath(); c.arc(c0, c0, S2*0.5, 0, TAU); c.fill();
    _sprites.goldSpark = oc;
  }
}

/* ── Generic shape functions (non-snow) ──────────────────────────────────── */
function drawCircle(ctx,r){ctx.beginPath();ctx.arc(0,0,r,0,TAU);}
function drawHexagon(ctx,r){ctx.beginPath();for(let i=0;i<6;i++){const a=(i/6)*TAU-Math.PI/6;i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();}
const SHAPE_FN={circle:drawCircle,hexagon:drawHexagon};

/* ── State ───────────────────────────────────────────────────────────────── */
let _particles   = null;
let _smoothBands = {subBass:0,bass:0,lowMid:0,mid:0,highMid:0,presence:0,brilliance:0,overall:0};
let _beatImpulse = 0, _smoothBass = 0;
let _prevW = 0, _prevH = 0;
let _config = { quantity:1.0, sizeRange:1.0, shape:"circle", opacity:1.0, direction:"down" };

export function setBokehConfig(cfg) {
  const needReinit = (cfg.quantity  !== undefined && cfg.quantity  !== _config.quantity)
                  || (cfg.shape     !== undefined && cfg.shape     !== _config.shape)
                  || (cfg.direction !== undefined && cfg.direction !== _config.direction);
  if (cfg.quantity  !== undefined) _config.quantity  = cfg.quantity;
  if (cfg.sizeRange !== undefined) _config.sizeRange = cfg.sizeRange;
  if (cfg.shape     !== undefined) _config.shape     = cfg.shape;
  if (cfg.opacity   !== undefined) _config.opacity   = cfg.opacity;
  if (cfg.direction !== undefined) _config.direction = cfg.direction;
  if (needReinit) _particles = null;
}
export function getBokehConfig() { return {..._config}; }

/* ── Particle init ───────────────────────────────────────────────────────── */
function initParticles(w, h) {
  const isSnow = _config.shape === "snowflake";
  const isRain = _config.shape === "raindrop";
  const isGold = _config.shape === "golddust";
  const layers = isSnow ? SNOW_LAYERS : isRain ? RAIN_LAYERS : isGold ? GOLD_LAYERS : LAYER_DEFS;
  const total  = Math.round((isRain ? 340 : isGold ? 260 : 280) * _config.quantity);
  const dir    = _config.direction;
  const pts    = [];

  for (let li=0; li<layers.length; li++) {
    const L = layers[li];
    const count = Math.max(4, Math.round(total * L.countFrac));
    for (let i=0; i<count; i++) {
      const idx   = pts.length;
      const depth = L.depthMin + Math.random()*(L.depthMax-L.depthMin);

      if (isGold) {
        const sizeT    = Math.pow(Math.random(), 1.3);
        const baseSize = (L.sizeMin + sizeT*(L.sizeMax-L.sizeMin)) * _config.sizeRange;
        const drift    = L.driftMin + Math.random()*(L.driftMax-L.driftMin);
        pts.push({
          x: Math.random()*w, y: Math.random()*h,
          vx0: (Math.random()-0.5)*0.0003,
          vy0: dir==="up" ? -drift : dir==="still" ? 0 : drift,
          baseSize, depth, layer: li, role: L.role,
          phase:        Math.random()*TAU,
          twinkleSpeed: 1.0 + Math.random()*2.6,
          variant:      idx % GOLD_VARIANTS,
          noiseOff:     idx*2.71 + Math.random()*50,
        });
        continue;
      }

      if (isRain) {
        pts.push({
          x: Math.random()*w, y: Math.random()*h,
          depth, layer: li,
          speed:  L.speedMin + Math.random()*(L.speedMax-L.speedMin),
          length: L.lenMin   + Math.random()*(L.lenMax-L.lenMin),
          thick: (L.thickMin + Math.random()*(L.thickMax-L.thickMin)) * _config.sizeRange,
          windJitter: (Math.random()-0.5)*0.10,
          noiseOff: idx*2.71 + Math.random()*50,
        });
        continue;
      }

      const sizeT = Math.pow(Math.random(), 1.3);
      const baseSize = (L.sizeMin + sizeT*(L.sizeMax-L.sizeMin)) * _config.sizeRange;

      let vy0;
      if (isSnow) {
        const spd = L.speedMin + Math.random()*(L.speedMax-L.speedMin);
        vy0 = dir==="up" ? -spd : dir==="still" ? 0 : spd;
      } else {
        const spd = (0.0008+depth*0.0014)*(0.6+Math.random()*0.8);
        vy0 = dir==="up" ? -spd : dir==="still" ? 0 : spd;
        if (_config.shape==="hexagon")  vy0 *= 0.4;
        if (_config.shape==="bubble")   vy0 *= 0.55;   // bubbles drift lazily
      }

      pts.push({
        x: Math.random()*w, y: Math.random()*h,
        vx0: (Math.random()-0.5)*0.0003,
        vy0, baseSize, depth, layer: li,
        sprite:    L.sprite||null,
        swayAmp:   L.swayAmp||0,
        swayFreq:  0.18 + Math.random()*0.16,
        swayPhase: Math.random()*TAU,
        phase:     Math.random()*TAU,
        noiseOff:  idx*2.71 + Math.random()*50,
        variant:      idx % DUST_VARIANTS,
        twinkleSpeed: 1.2 + Math.random()*2.4,
        rotAngle:  Math.random()*TAU,
        rotSpeed:  (L.rotSpeed||0.002)*(0.4+Math.random()*0.8)*(Math.random()<0.5?1:-1),
      });
    }
  }
  pts.sort((a,b)=>a.depth-b.depth);
  return pts;
}

/* ── Main render ─────────────────────────────────────────────────────────── */
export function renderBokehSparkle(ctx, w, h, t, bands) {
  if (!_particles || w!==_prevW || h!==_prevH) {
    _particles = initParticles(w,h); _prevW=w; _prevH=h;
  }

  const isSnow   = _config.shape==="snowflake";
  const isBubble = _config.shape==="bubble";
  const isRain   = _config.shape==="raindrop";
  const isGold   = _config.shape==="golddust";
  if (isSnow)   buildSprites();        // no-op after first call
  if (isBubble) buildBubbleSprite();
  if (isRain)   buildRainSprite();
  if (isGold)   buildGoldSprites();
  if (_config.shape==="circle") buildDustSprites();

  const time   = t*0.001;
  const bass   = bands.bass||0;
  const minDim = Math.min(w,h);
  const layers = isSnow ? SNOW_LAYERS : isRain ? RAIN_LAYERS : isGold ? GOLD_LAYERS : LAYER_DEFS;
  const dir    = _config.direction;

  for (const k of Object.keys(_smoothBands))
    _smoothBands[k] += ((bands[k]||0)-_smoothBands[k])*0.1;

  _smoothBass  += (bass-_smoothBass)*0.05;
  const spike   = Math.max(0, bass-_smoothBass-0.06);
  _beatImpulse += spike*4; _beatImpulse *= 0.82;

  // coherent wind — one gust drives rain slant & snow drift together (musical sway)
  const wind = simplex.noise2D(time*0.12, 7.3)*0.10 + Math.sin(time*0.23)*0.05 + _beatImpulse*0.03;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let pi=0; pi<_particles.length; pi++) {
    const p = _particles[pi];
    const L = layers[p.layer];

    let freq=0;
    for (const fk of L.freqKeys) freq+=(_smoothBands[fk]||0);
    freq /= L.freqKeys.length;

    // ── GOLDEN DUST: soft bokeh discs + fine sparkle glitter ──
    if (isGold) {
      // gentle float + noise wander + coherent wind
      let dy = p.vy0*h*(1+freq*0.3);
      let dx = p.vx0*h
             + simplex.noise2D(p.noiseOff, time*0.05)*minDim*0.00022
             + wind*minDim*0.0008*(0.3+p.depth);
      if (dir==="still") dy  = simplex.noise2D(p.noiseOff+300, time*0.04)*minDim*0.00022;
      else               dy += simplex.noise2D(p.noiseOff+200, time*0.05)*minDim*0.00016;
      p.x += dx; p.y += dy;

      const m = p.baseSize*minDim + 20;
      if (p.y>h+m)  { p.y=-m;  p.x=Math.random()*w; }
      if (p.y<-m)   { p.y=h+m; p.x=Math.random()*w; }
      if (p.x>w+m)    p.x=-m;
      if (p.x<-m)     p.x=w+m;

      // size: breathe + beat bloom
      const breathe = 1 + Math.sin(time*0.5+p.phase)*0.08;
      const bloom   = 1 + _beatImpulse*0.16;
      const r = p.baseSize*minDim*breathe*bloom*(1+freq*0.12);
      if (r<0.4) { continue; }

      ctx.save();
      ctx.translate(p.x, p.y);

      if (p.role === "glitter") {
        // organic twinkle — two out-of-phase harmonics so flashes feel irregular,
        // not metronomic. The glow blooms on peaks & beats (soft, no hard star).
        const tw  = 0.5 + 0.5*Math.sin(time*p.twinkleSpeed + p.phase);
        const tw2 = tw * (0.7 + 0.3*Math.sin(time*p.twinkleSpeed*2.3 + p.phase*1.7));
        const a   = Math.min(0.95, (L.alphaBase + freq*L.alphaFreq + _beatImpulse*0.06) * _config.opacity * (0.32+tw2));
        if (a >= 0.01 && _sprites.goldSpark) {
          // soft glow that swells on twinkle peaks & beats → natural sparkle bloom
          const bloom = r * (2.0 + tw2*2.4 + _beatImpulse*1.6);
          ctx.globalAlpha = a;
          ctx.drawImage(_sprites.goldSpark, -bloom/2, -bloom/2, bloom, bloom);
          // tiny crisp hot core keeps the pinpoint "spark" feel
          ctx.globalAlpha = Math.min(0.95, a*1.1);
          ctx.fillStyle   = "rgba(255,247,218,1)";
          ctx.beginPath(); ctx.arc(0, 0, Math.max(0.4, r*0.34), 0, TAU); ctx.fill();
        }
      } else {
        // soft defocused bokeh disc — slow shimmer
        const sprite = _sprites.goldBokeh[p.variant];
        const tw = 0.72 + 0.28*Math.sin(time*p.twinkleSpeed*0.5 + p.phase);
        const a  = Math.min(0.85, (L.alphaBase + freq*L.alphaFreq + _beatImpulse*0.04) * _config.opacity * tw);
        if (a >= 0.006 && sprite) {
          const dim = r*2.1;
          ctx.globalAlpha = a;
          ctx.drawImage(sprite, -dim/2, -dim/2, dim, dim);
        }
      }

      ctx.restore();
      continue;
    }

    // ── RAIN: motion-blurred, depth-layered streaks ──────────
    if (isRain) {
      const energy = _smoothBands.overall || 0;
      const surge  = 1 + energy*0.5 + _beatImpulse*0.22;          // downpour speeds up on beats/peaks
      const vy = p.speed*h*surge;
      const vx = vy*(wind + p.windJitter);
      p.x += vx; p.y += vy;

      const streak = p.length*h*(1 + energy*0.25 + _beatImpulse*0.20); // streaks stretch on the beat
      if (p.y - streak > h) { p.y = -Math.random()*h*0.25; p.x = Math.random()*w; }
      if (p.x > w+60)      p.x -= (w+120);
      else if (p.x < -60)  p.x += (w+120);

      const alpha = Math.min(0.72, (L.alphaBase + freq*L.alphaFreq + _beatImpulse*0.05) * _config.opacity);
      if (alpha < 0.006) continue;

      const tw = Math.max(0.6, p.thick*minDim);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(-vx, vy));                             // align streak to fall direction
      // near-layer defocus halo → foreground depth-of-field
      if (p.depth > 0.8) {
        ctx.globalAlpha = alpha*0.32;
        ctx.drawImage(_sprites.rain, -(tw*2.6)/2, -streak*1.04, tw*2.6, streak*1.04);
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(_sprites.rain, -tw/2, -streak, tw, streak);
      ctx.restore();
      continue;
    }

    // ── Movement ─────────────────────────────────────────────
    const speedBoost = 1 + freq*0.45 + _beatImpulse*0.10;
    let dy = p.vy0*h*speedBoost;
    let dx = p.vx0*h;

    if (isSnow) {
      // Smooth sway per particle — sine only, noise is small correction
      const sway = Math.sin(time*p.swayFreq + p.swayPhase)
                 + simplex.noise2D(p.noiseOff, time*0.025) * 0.3;
      dx += sway * p.swayAmp * minDim;
      dx += wind * minDim * 0.0018 * (0.35 + p.depth);   // coherent wind gust — near flakes pushed more
      dy *= 1 + simplex.noise2D(p.noiseOff+10, time*0.04)*0.15;
      if (_beatImpulse > 0.05)
        dx += simplex.noise2D(p.noiseOff+400, time*1.5)*_beatImpulse*p.depth*minDim*0.0003;
      if (dir==="still")
        dy = simplex.noise2D(p.noiseOff+300, time*0.03)*minDim*0.00030;
    } else if (isBubble) {
      // gentle wobble as bubbles drift — stronger sway than dust
      dx += Math.sin(time*(0.5+p.swayFreq) + p.swayPhase) * minDim*0.00030*(0.4+p.depth)
          + simplex.noise2D(p.noiseOff, time*0.05)*minDim*0.00020;
      const ny=simplex.noise2D(p.noiseOff+200, time*0.05)*minDim*0.00020;
      dy = dir==="still" ? ny : dy*0.75+ny;
    } else if (_config.shape==="hexagon") {
      dx += simplex.noise2D(p.x/w*2, time*0.06+p.noiseOff)*minDim*0.0007;
      const ny=simplex.noise2D(p.y/h*2, time*0.06+p.noiseOff+100)*minDim*0.0005;
      dy = dir==="still" ? ny : dy+ny;
    } else {
      dx += simplex.noise2D(p.noiseOff, time*0.07)*minDim*0.0005;
      const ny=simplex.noise2D(p.noiseOff+200, time*0.07)*minDim*0.0003;
      dy = dir==="still" ? ny : dy+ny;
    }

    p.x+=dx; p.y+=dy;

    const m = p.baseSize*minDim*3+10;
    if (p.y>h+m)  { p.y=-m;  p.x=Math.random()*w; }
    if (p.y<-m-10){ p.y=h+m; p.x=Math.random()*w; }
    if (p.x>w+m)   p.x=-m;
    if (p.x<-m)    p.x=w+m;

    // Size
    const beatPulse = 1+_beatImpulse*0.14;
    const breathe   = 1+Math.sin(time*0.55+p.phase)*0.06;
    const r = p.baseSize*minDim*beatPulse*breathe*(1+freq*0.12);
    if (r<0.4) continue;

    // Rotation (snow rotates slowly, real snowflakes tumble gently)
    p.rotAngle += p.rotSpeed*(1+freq*0.2);

    // Alpha
    const alpha = Math.min(0.80,
      (L.alphaBase + freq*L.alphaFreq + _beatImpulse*0.03) * _config.opacity
    );
    if (alpha<0.006) continue;

    ctx.save();

    if (isSnow) {
      // ── Sprite drawImage — no path building per frame ─────
      const sprite = _sprites[p.sprite];
      if (!sprite) { ctx.restore(); continue; }

      const dim = r * 2.6;          // display size = arm radius × 2.6 (sprite has margin)
      ctx.translate(p.x, p.y);
      // depth-of-field bokeh — near flakes get a soft defocused glow behind them
      if (p.depth > 0.72 && _sprites.dot) {
        const gdim = dim * 1.9;
        ctx.globalAlpha = alpha * 0.28;
        ctx.drawImage(_sprites.dot, -gdim/2, -gdim/2, gdim, gdim);
      }
      ctx.rotate(p.rotAngle);
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, -dim/2, -dim/2, dim, dim);

    } else {
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotAngle);   // hexagon tumbles slowly

      const shape = _config.shape;

      if (shape === "bubble") {
        // ── Bubble sprite — source-over so the dark rim reads on bright bg ─
        const sprite = _sprites.bubble;
        if (!sprite) { ctx.restore(); continue; }
        ctx.globalCompositeOperation = "source-over";
        ctx.rotate(-p.rotAngle);   // keep the specular highlight upper-left
        // subtle squash & stretch wobble like a real drifting bubble
        const wob = Math.sin(time*2.2 + p.phase)*0.05;
        ctx.scale(1+wob, 1-wob);
        const dim = r * 2.4;
        ctx.globalAlpha = Math.min(1, alpha*1.5);
        ctx.drawImage(sprite, -dim/2, -dim/2, dim, dim);

      } else if (shape === "hexagon") {
        // ── Crisp outline — 2-pass stroke (glow + crisp) ─────
        const shapeFn = SHAPE_FN[shape];
        const sr  = r * 0.82;
        const lw  = Math.max(0.6, r * 0.072);

        // Soft inner fill (gives the "lit interior" feel)
        ctx.globalAlpha = alpha * 0.14;
        ctx.fillStyle   = "white";
        shapeFn(ctx, sr); ctx.fill();

        ctx.lineCap  = "round";
        ctx.lineJoin = "round";

        // Glow pass — fat & faint
        ctx.globalAlpha  = alpha * 0.22;
        ctx.strokeStyle  = "white";
        ctx.lineWidth    = lw * 4.0;
        shapeFn(ctx, sr); ctx.stroke();

        // Crisp pass — thin & bright
        ctx.globalAlpha = alpha * 0.92;
        ctx.lineWidth   = lw * 0.85;
        shapeFn(ctx, sr); ctx.stroke();

        // Tiny center dot for near-layer particles
        if (p.depth > 0.45 && r > minDim * 0.003) {
          ctx.globalAlpha = alpha * 0.70;
          ctx.fillStyle   = "white";
          ctx.beginPath(); ctx.arc(0, 0, lw * 1.2, 0, TAU); ctx.fill();
        }

      } else {
        // ── Circle: sunset dust motes — pre-baked warm sprites + twinkle ──
        //    (sprite drawImage per frame; no gradient allocation → no jank)
        const blurFactor = (1-p.depth)*0.5+0.5;
        const glowR = r*(1+blurFactor*0.8);

        // per-particle twinkle — each mote shimmers on its own rhythm
        const tw = 0.62 + 0.38*Math.sin(time*p.twinkleSpeed + p.phase);
        const a2 = Math.min(0.9, alpha*(0.55 + tw*0.75) + freq*0.05);

        const sprite = _sprites.dust && _sprites.dust[p.variant];
        if (sprite) {
          const dim = glowR*2.1;
          ctx.globalAlpha = a2;
          ctx.drawImage(sprite, -dim/2, -dim/2, dim, dim);
        }

        // star glint ✦ on bright near motes — flashes at twinkle peaks
        if (p.depth > 0.55 && r > minDim*0.003 && tw > 0.72 && _sprites.glint) {
          const flash = (tw-0.72)/0.28;                 // 0→1 across the peak
          const gDim  = glowR*(1.6 + flash*1.8);
          ctx.globalAlpha = Math.min(0.85, alpha*flash*1.4);
          ctx.rotate(Math.PI/4 + Math.sin(p.phase)*0.3);
          ctx.drawImage(_sprites.glint, -gDim/2, -gDim/2, gDim, gDim);
        }
      }
    }

    ctx.restore();
  }

  ctx.restore();
}

export function resetBokehSparkle() {
  _particles=null;
  _smoothBands={subBass:0,bass:0,lowMid:0,mid:0,highMid:0,presence:0,brilliance:0,overall:0};
  _beatImpulse=0; _smoothBass=0; _prevW=0; _prevH=0;
  // clear sprite cache so they rebuild on next use
  delete _sprites.dot; delete _sprites.simple; delete _sprites.crystal; delete _sprites.flake; delete _sprites.bubble; delete _sprites.dust; delete _sprites.glint; delete _sprites.rain; delete _sprites.goldBokeh; delete _sprites.goldSpark;
}
