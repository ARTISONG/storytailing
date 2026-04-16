// ─── BOKEH SPARKLE — elegant floating particles ───────────────────────────────
import { simplex } from "../utils/simplex.js";

const TAU  = Math.PI * 2;
const PHI  = 1.6180339887;

// Pre-baked arm angles for 6-fold snowflake (avoid recomputing every frame)
const ARM6_COS = [], ARM6_SIN = [];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * TAU - Math.PI / 2;
  ARM6_COS.push(Math.cos(a)); ARM6_SIN.push(Math.sin(a));
}

/* ── Generic layer defs (circle / hexagon / raindrop) ────────────────────── */
const LAYER_DEFS = [
  { freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.25, sizeMin:0.012, sizeMax:0.030, countFrac:0.18, alphaBase:0.08, alphaFreq:0.14 },
  { freqKeys:["lowMid","mid"],       depthMin:0.20, depthMax:0.50, sizeMin:0.006, sizeMax:0.018, countFrac:0.30, alphaBase:0.10, alphaFreq:0.18 },
  { freqKeys:["highMid","presence"], depthMin:0.45, depthMax:0.75, sizeMin:0.002, sizeMax:0.010, countFrac:0.30, alphaBase:0.13, alphaFreq:0.22 },
  { freqKeys:["brilliance"],         depthMin:0.70, depthMax:1.00, sizeMin:0.001, sizeMax:0.006, countFrac:0.22, alphaBase:0.16, alphaFreq:0.28 },
];

/* ── Snow-specific layers — strong depth separation ──────────────────────── */
// speedMin/Max = fraction of canvas-height per frame @ 60fps
// renderStyle: "dot" | "simple" | "crystal" | "flake"
const SNOW_LAYERS = [
  { freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.22, sizeMin:0.0008, sizeMax:0.0022, speedMin:0.00080, speedMax:0.00140, countFrac:0.35, alphaBase:0.05, alphaFreq:0.08,  renderStyle:"dot",     swayAmp:0.00008, rotSpeed:0.000 },
  { freqKeys:["lowMid","mid"],       depthMin:0.22, depthMax:0.50, sizeMin:0.0022, sizeMax:0.0060, speedMin:0.00150, speedMax:0.00260, countFrac:0.30, alphaBase:0.10, alphaFreq:0.15,  renderStyle:"simple",  swayAmp:0.00020, rotSpeed:0.001 },
  { freqKeys:["highMid","presence"], depthMin:0.50, depthMax:0.78, sizeMin:0.0060, sizeMax:0.0150, speedMin:0.00280, speedMax:0.00460, countFrac:0.22, alphaBase:0.20, alphaFreq:0.22,  renderStyle:"crystal", swayAmp:0.00038, rotSpeed:0.002 },
  { freqKeys:["brilliance"],         depthMin:0.78, depthMax:1.00, sizeMin:0.0150, sizeMax:0.0340, speedMin:0.00500, speedMax:0.00860, countFrac:0.13, alphaBase:0.35, alphaFreq:0.32,  renderStyle:"flake",   swayAmp:0.00065, rotSpeed:0.004 },
];

let _particles   = null;
let _smoothBands = { subBass:0, bass:0, lowMid:0, mid:0, highMid:0, presence:0, brilliance:0, overall:0 };
let _beatImpulse = 0;
let _smoothBass  = 0;
let _prevW = 0, _prevH = 0;

let _config = {
  quantity:  1.0,
  sizeRange: 1.0,
  shape:     "circle",
  opacity:   1.0,
  direction: "down",
};

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
export function getBokehConfig() { return { ..._config }; }

/* ── Generic shape renderers ─────────────────────────────────────────────── */
function drawCircle(ctx, r) { ctx.beginPath(); ctx.arc(0,0,r,0,TAU); }
function drawHexagon(ctx, r) {
  ctx.beginPath();
  for (let i=0;i<6;i++) {
    const a=(i/6)*TAU-Math.PI/6;
    i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);
  }
  ctx.closePath();
}
function drawRaindrop(ctx, r) {
  ctx.beginPath();
  ctx.arc(0,r*0.2,r*0.55,0.3,Math.PI-0.3,false);
  ctx.lineTo(0,-r*0.95); ctx.closePath();
}
const SHAPE_FN = { circle:drawCircle, hexagon:drawHexagon, raindrop:drawRaindrop };

/* ── Snow path builders (NO shadowBlur — 2-pass stroke for glow effect) ──── */

// Build 6-arm path into current context
function buildArms(ctx, r) {
  ctx.beginPath();
  for (let i=0;i<6;i++) {
    ctx.moveTo(0,0); ctx.lineTo(ARM6_COS[i]*r, ARM6_SIN[i]*r);
  }
}

// Build arms + 1 branch level
function buildCrystal(ctx, r) {
  ctx.beginPath();
  const br = r*0.38, bo = 0.58;
  for (let i=0;i<6;i++) {
    const ca=ARM6_COS[i], sa=ARM6_SIN[i];
    ctx.moveTo(0,0); ctx.lineTo(ca*r, sa*r);
    const bx=ca*r*bo, by=sa*r*bo;
    // angle of branch = arm angle ±72° (pre-cos/sin would be ideal but 12 values total, keep simple)
    const a = (i/6)*TAU - Math.PI/2;
    for (const s of [-1,1]) {
      const ba=a+s*0.72;
      ctx.moveTo(bx,by); ctx.lineTo(bx+Math.cos(ba)*br, by+Math.sin(ba)*br);
    }
  }
}

// Build full flake: arms + 2 branch levels
function buildFlake(ctx, r) {
  ctx.beginPath();
  for (let i=0;i<6;i++) {
    const ca=ARM6_COS[i], sa=ARM6_SIN[i];
    const a=(i/6)*TAU - Math.PI/2;
    ctx.moveTo(0,0); ctx.lineTo(ca*r, sa*r);
    // Outer branch at 62%
    const b1x=ca*r*0.62, b1y=sa*r*0.62, b1l=r*0.38;
    for (const s of [-1,1]) {
      const ba=a+s*0.70;
      ctx.moveTo(b1x,b1y); ctx.lineTo(b1x+Math.cos(ba)*b1l, b1y+Math.sin(ba)*b1l);
    }
    // Inner branch at 33%
    const b2x=ca*r*0.33, b2y=sa*r*0.33, b2l=r*0.22;
    for (const s of [-1,1]) {
      const ba=a+s*0.72;
      ctx.moveTo(b2x,b2y); ctx.lineTo(b2x+Math.cos(ba)*b2l, b2y+Math.sin(ba)*b2l);
    }
  }
}

// 2-pass stroke: wide+faint glow, then thin+crisp line
// NO shadowBlur needed — much faster
function strokeGlow(ctx, buildFn, r, lw, rgba, glowA) {
  buildFn(ctx, r);
  ctx.lineWidth = lw * 3.5;
  ctx.strokeStyle = glowA;
  ctx.stroke();
  ctx.lineWidth = lw;
  ctx.strokeStyle = rgba;
  ctx.stroke();
}

// Fast dot for far particles: 3 overlapping arcs, no gradient object
function strokeDot(ctx, r, alpha, wR, wG, wB) {
  ctx.beginPath(); ctx.arc(0,0,r*2.2,0,TAU);
  ctx.fillStyle=`rgba(${wR},${wG},${wB},${(alpha*0.08).toFixed(3)})`; ctx.fill();
  ctx.beginPath(); ctx.arc(0,0,r*1.2,0,TAU);
  ctx.fillStyle=`rgba(${wR},${wG},${wB},${(alpha*0.25).toFixed(3)})`; ctx.fill();
  ctx.beginPath(); ctx.arc(0,0,r*0.4,0,TAU);
  ctx.fillStyle=`rgba(${wR},${wG},${wB},${(alpha*0.55).toFixed(3)})`; ctx.fill();
}

/* ── Particle init ───────────────────────────────────────────────────────── */
function initParticles(w, h) {
  const isSnow = _config.shape === "snowflake";
  const layers = isSnow ? SNOW_LAYERS : LAYER_DEFS;
  const total  = Math.round(300 * _config.quantity);
  const dir    = _config.direction;
  const pts    = [];

  for (let li=0; li<layers.length; li++) {
    const L     = layers[li];
    const count = Math.max(4, Math.round(total * L.countFrac));
    for (let i=0; i<count; i++) {
      const idx   = pts.length;
      const depth = L.depthMin + Math.random() * (L.depthMax - L.depthMin);
      const sizeT = Math.pow(Math.random(), 1.3);
      const baseSize = (L.sizeMin + sizeT*(L.sizeMax-L.sizeMin)) * _config.sizeRange;

      let vy0;
      if (isSnow) {
        const spd = L.speedMin + Math.random() * (L.speedMax - L.speedMin);
        vy0 = dir==="up" ? -spd : dir==="still" ? 0 : spd;
      } else {
        const spd = (0.0008 + depth*0.0014) * (0.6 + Math.random()*0.8);
        vy0 = dir==="up" ? -spd : dir==="still" ? 0 : spd;
        if (_config.shape==="raindrop") vy0 *= (dir==="still" ? 1 : 3.5+depth*2);
        if (_config.shape==="hexagon")  vy0 *= 0.4;
      }

      pts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx0:  (Math.random()-0.5) * 0.0003,
        vy0,
        baseSize,
        depth,
        layer: li,
        renderStyle: L.renderStyle || null,
        swayAmp:   L.swayAmp   || 0,
        swayFreq:  0.20 + Math.random()*0.18,   // per-particle sway freq (rad/s)
        swayPhase: Math.random() * TAU,
        phase:     Math.random() * TAU,
        noiseOff:  idx * 2.71 + Math.random() * 50,
        rotAngle:  Math.random() * TAU,
        rotSpeed:  (L.rotSpeed||0.002) * (0.4+Math.random()*0.8) * (Math.random()<0.5?1:-1),
        warmth:    0.88 + Math.random()*0.12,
      });
    }
  }
  pts.sort((a,b) => a.depth - b.depth);
  return pts;
}

/* ── Main render ─────────────────────────────────────────────────────────── */
export function renderBokehSparkle(ctx, w, h, t, bands) {
  if (!_particles || w!==_prevW || h!==_prevH) {
    _particles = initParticles(w, h);
    _prevW=w; _prevH=h;
  }

  const time   = t * 0.001;
  const bass   = bands.bass || 0;
  const minDim = Math.min(w, h);
  const isSnow = _config.shape === "snowflake";
  const layers = isSnow ? SNOW_LAYERS : LAYER_DEFS;
  const dir    = _config.direction;

  for (const k of Object.keys(_smoothBands))
    _smoothBands[k] += ((bands[k]||0) - _smoothBands[k]) * 0.1;

  _smoothBass  += (bass - _smoothBass) * 0.05;
  const spike   = Math.max(0, bass - _smoothBass - 0.06);
  _beatImpulse += spike * 4;
  _beatImpulse *= 0.82;

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.lineCap = "round";

  for (let pi=0; pi<_particles.length; pi++) {
    const p = _particles[pi];
    const L = layers[p.layer];

    let freq = 0;
    for (const fk of L.freqKeys) freq += (_smoothBands[fk]||0);
    freq /= L.freqKeys.length;

    // ── Movement ───────────────────────────────────────────
    const speedBoost = 1 + freq*0.5 + _beatImpulse*0.12;
    let dy = p.vy0 * h * speedBoost;
    let dx = p.vx0 * h;

    if (isSnow) {
      // Smooth per-particle sway: slow sine (no discontinuity)
      const sway = Math.sin(time * p.swayFreq + p.swayPhase)
                 + simplex.noise2D(p.noiseOff, time * 0.03) * 0.35;
      dx += sway * p.swayAmp * minDim;
      // Gust: multiplicative variation stays smooth
      dy *= 1 + simplex.noise2D(p.noiseOff+10, time*0.05) * 0.18;
      // Beat lift (near particles)
      if (_beatImpulse > 0.05)
        dx += simplex.noise2D(p.noiseOff+400, time*2) * _beatImpulse * p.depth * minDim * 0.00035;

    } else if (_config.shape==="raindrop") {
      dx += simplex.noise2D(p.noiseOff, time*0.02) * minDim * 0.00012;
    } else if (_config.shape==="hexagon") {
      dx += simplex.noise2D(p.x/w*2, time*0.06+p.noiseOff)       * minDim * 0.0007;
      const ny = simplex.noise2D(p.y/h*2, time*0.06+p.noiseOff+100) * minDim * 0.0005;
      dy = dir==="still" ? ny : dy+ny;
    } else {
      dx += simplex.noise2D(p.noiseOff,     time*0.07) * minDim * 0.0005;
      const ny = simplex.noise2D(p.noiseOff+200, time*0.07) * minDim * 0.0003;
      dy = dir==="still" ? ny : dy+ny;
    }

    if (dir==="still" && isSnow)
      dy = simplex.noise2D(p.noiseOff+300, time*0.04) * minDim * 0.00035;

    p.x += dx; p.y += dy;

    // Wrap
    const m = p.baseSize * minDim * 3 + 10;
    if (p.y >  h+m)  { p.y=-m;  p.x=Math.random()*w; }
    if (p.y < -m-10) { p.y=h+m; p.x=Math.random()*w; }
    if (p.x >  w+m)   p.x=-m;
    if (p.x < -m)      p.x=w+m;

    // Size
    const beatPulse = 1 + _beatImpulse*0.16;
    const breathe   = 1 + Math.sin(time*0.6+p.phase)*0.07;
    const r = p.baseSize * minDim * beatPulse * breathe * (1+freq*0.14);
    if (r < 0.3) continue;

    // Rotation
    p.rotAngle += p.rotSpeed * (1+freq*0.3);

    // Alpha — no per-particle flicker for snow (reduces jitter feel)
    const flickerMul = isSnow ? 1 : (1 + Math.sin(time*1.5+p.phase)*0.08);
    const alpha = Math.min(0.78,
      (L.alphaBase + freq*L.alphaFreq + _beatImpulse*0.04) * _config.opacity * flickerMul
    );
    if (alpha < 0.006) continue;

    // Color
    const wR = Math.round(228 + p.warmth*27);
    const wG = Math.round(226 + p.warmth*25 + freq*6);
    const wB = Math.round(220 + p.warmth*20 + p.depth*14);
    const rgba     = `rgba(${wR},${wG},${wB},${alpha.toFixed(3)})`;
    const glowRgba = `rgba(${wR},${wG},${wB},${(alpha*0.12).toFixed(3)})`;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotAngle);

    if (isSnow) {
      const style = p.renderStyle;

      if (style === "dot") {
        // Far: 3 fast arcs, no gradient, no shadow
        strokeDot(ctx, r, alpha, wR, wG, wB);

      } else if (style === "simple") {
        // Mid-far: 6 arms, 2-pass glow
        ctx.fillStyle = rgba;
        strokeGlow(ctx, buildArms, r, Math.max(0.5, r*0.07), rgba, glowRgba);

      } else if (style === "crystal") {
        // Mid-near: full crystal, 2-pass glow
        ctx.fillStyle = rgba;
        strokeGlow(ctx, buildCrystal, r, Math.max(0.7, r*0.075), rgba, glowRgba);
        // Center dot
        ctx.fillStyle = rgba;
        ctx.beginPath(); ctx.arc(0,0,r*0.08,0,TAU); ctx.fill();

      } else { // "flake" — near, large
        // Outer aura: 2 fast arcs instead of radialGradient
        ctx.fillStyle = `rgba(${wR},${wG},${wB},${(alpha*0.07).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(0,0,r*2.0,0,TAU); ctx.fill();
        ctx.fillStyle = `rgba(${wR},${wG},${wB},${(alpha*0.12).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(0,0,r*1.2,0,TAU); ctx.fill();
        // Crystal, 2-pass glow
        ctx.fillStyle = rgba;
        strokeGlow(ctx, buildFlake, r, Math.max(0.9, r*0.08), rgba, glowRgba);
        // Center hex dot
        ctx.beginPath();
        for (let i=0;i<6;i++) {
          const a=(i/6)*TAU, cr=r*0.09;
          i===0?ctx.moveTo(Math.cos(a)*cr,Math.sin(a)*cr):ctx.lineTo(Math.cos(a)*cr,Math.sin(a)*cr);
        }
        ctx.closePath(); ctx.fill();
      }

    } else {
      // Generic filled shape (circle / hexagon / raindrop)
      const shapeFn = SHAPE_FN[_config.shape] || drawCircle;
      const blurFactor = (1-p.depth)*0.5 + 0.5;
      const glowR = r * (1+blurFactor*0.8);
      const g = ctx.createRadialGradient(0,0,0, 0,0,glowR);
      g.addColorStop(0,    `rgba(${wR},${wG},${wB},${(alpha*0.85).toFixed(3)})`);
      g.addColorStop(0.30, `rgba(${wR},${wG},${wB},${(alpha*0.50).toFixed(3)})`);
      g.addColorStop(0.65, `rgba(${wR},${wG},${wB},${(alpha*0.15).toFixed(3)})`);
      g.addColorStop(1,    `rgba(${wR},${wG},${wB},0)`);
      ctx.fillStyle = g;
      shapeFn(ctx, glowR); ctx.fill();
      if (p.depth > 0.5 && r > minDim*0.002) {
        ctx.fillStyle = `rgba(255,255,255,${(alpha*0.35).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(0,0,r*0.18,0,TAU); ctx.fill();
      }
    }

    ctx.restore();
  }

  ctx.restore();
}

export function resetBokehSparkle() {
  _particles   = null;
  _smoothBands = { subBass:0, bass:0, lowMid:0, mid:0, highMid:0, presence:0, brilliance:0, overall:0 };
  _beatImpulse = 0; _smoothBass = 0;
  _prevW = 0; _prevH = 0;
}
