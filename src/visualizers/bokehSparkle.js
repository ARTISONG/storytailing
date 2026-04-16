// ─── BOKEH SPARKLE — elegant floating particles ───────────────────────────────
import { simplex } from "../utils/simplex.js";

const TAU      = Math.PI * 2;
const PHI      = 1.6180339887;

/* ── Generic layer definitions (non-snow shapes) ─────────────────────────── */
const LAYER_DEFS = [
  { freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.25, sizeMin:0.012, sizeMax:0.030, countFrac:0.18, alphaBase:0.08, alphaFreq:0.14 },
  { freqKeys:["lowMid","mid"],       depthMin:0.20, depthMax:0.50, sizeMin:0.006, sizeMax:0.018, countFrac:0.30, alphaBase:0.10, alphaFreq:0.18 },
  { freqKeys:["highMid","presence"], depthMin:0.45, depthMax:0.75, sizeMin:0.002, sizeMax:0.010, countFrac:0.30, alphaBase:0.13, alphaFreq:0.22 },
  { freqKeys:["brilliance"],         depthMin:0.70, depthMax:1.00, sizeMin:0.001, sizeMax:0.006, countFrac:0.22, alphaBase:0.16, alphaFreq:0.28 },
];

/* ── Snow-specific layers — strong depth separation ──────────────────────── */
// renderStyle: "dot"=blurry far dot, "simple"=thin 6-arm, "crystal"=full branches, "flake"=large+sub-branches
const SNOW_LAYERS = [
  { freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.22, sizeMin:0.0006, sizeMax:0.0018, speedMin:0.00035, speedMax:0.00060, countFrac:0.38, alphaBase:0.04, alphaFreq:0.07, renderStyle:"dot",     swayAmp:0.00010, rotSpeed:0.0000 },
  { freqKeys:["lowMid","mid"],       depthMin:0.22, depthMax:0.50, sizeMin:0.0018, sizeMax:0.0050, speedMin:0.00065, speedMax:0.00110, countFrac:0.30, alphaBase:0.09, alphaFreq:0.14, renderStyle:"simple",   swayAmp:0.00022, rotSpeed:0.0006 },
  { freqKeys:["highMid","presence"], depthMin:0.50, depthMax:0.78, sizeMin:0.0050, sizeMax:0.0130, speedMin:0.00120, speedMax:0.00200, countFrac:0.20, alphaBase:0.18, alphaFreq:0.22, renderStyle:"crystal",  swayAmp:0.00040, rotSpeed:0.0012 },
  { freqKeys:["brilliance"],         depthMin:0.78, depthMax:1.00, sizeMin:0.0130, sizeMax:0.0300, speedMin:0.00220, speedMax:0.00380, countFrac:0.12, alphaBase:0.30, alphaFreq:0.30, renderStyle:"flake",    swayAmp:0.00070, rotSpeed:0.0020 },
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

/* ── Shape renderers ─────────────────────────────────────────────────────── */
function drawCircle(ctx, r) {
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
}
function drawHexagon(ctx, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i/6)*TAU - Math.PI/6;
    i===0 ? ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r)
          : ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
  }
  ctx.closePath();
}
function drawRaindrop(ctx, r) {
  ctx.beginPath();
  ctx.arc(0, r*0.2, r*0.55, 0.3, Math.PI-0.3, false);
  ctx.lineTo(0, -r*0.95);
  ctx.closePath();
}
const SHAPE_FN = { circle:drawCircle, hexagon:drawHexagon, raindrop:drawRaindrop };

/* ── Snow crystal renderers (per render style) ───────────────────────────── */
// "dot" — blurry soft disc (far away, out of focus)
function snowDot(ctx, r, alpha, wR, wG, wB) {
  const g = ctx.createRadialGradient(0,0,0, 0,0,r);
  g.addColorStop(0,   `rgba(${wR},${wG},${wB},${(alpha*0.9).toFixed(3)})`);
  g.addColorStop(0.4, `rgba(${wR},${wG},${wB},${(alpha*0.4).toFixed(3)})`);
  g.addColorStop(1,   `rgba(${wR},${wG},${wB},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0,0,r,0,TAU); ctx.fill();
}

// "simple" — just 6 arms, no branches (mid-far)
function snowSimple(ctx, r, lw) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i/6)*TAU - Math.PI/2;
    ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
  }
  ctx.lineWidth = lw;
  ctx.stroke();
}

// "crystal" — 6 arms + one branch level (mid-near)
function snowCrystal(ctx, r, lw) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a  = (i/6)*TAU - Math.PI/2;
    const ca = Math.cos(a), sa = Math.sin(a);
    ctx.moveTo(0,0); ctx.lineTo(ca*r, sa*r);
    // branch at 58%
    const bx = ca*r*0.58, by = sa*r*0.58, bl = r*0.38;
    for (const s of [-1,1]) {
      const ba = a + s*0.72;
      ctx.moveTo(bx, by); ctx.lineTo(bx+Math.cos(ba)*bl, by+Math.sin(ba)*bl);
    }
  }
  ctx.lineWidth = lw;
  ctx.stroke();
  // tiny center dot
  ctx.beginPath(); ctx.arc(0,0,lw*1.2,0,TAU); ctx.fill();
}

// "flake" — 6 arms + two branch levels + tip details (near, large)
function snowFlake(ctx, r, lw) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a  = (i/6)*TAU - Math.PI/2;
    const ca = Math.cos(a), sa = Math.sin(a);
    ctx.moveTo(0,0); ctx.lineTo(ca*r, sa*r);
    // Outer branch (60%)
    const b1x = ca*r*0.60, b1y = sa*r*0.60, b1l = r*0.40;
    for (const s of [-1,1]) {
      const ba = a + s*0.70;
      ctx.moveTo(b1x, b1y); ctx.lineTo(b1x+Math.cos(ba)*b1l, b1y+Math.sin(ba)*b1l);
    }
    // Inner branch (32%)
    const b2x = ca*r*0.32, b2y = sa*r*0.32, b2l = r*0.22;
    for (const s of [-1,1]) {
      const ba = a + s*0.72;
      ctx.moveTo(b2x, b2y); ctx.lineTo(b2x+Math.cos(ba)*b2l, b2y+Math.sin(ba)*b2l);
    }
    // Tip notch (90%)
    const b3x = ca*r*0.90, b3y = sa*r*0.90, b3l = r*0.12;
    for (const s of [-1,1]) {
      const ba = a + s*0.65;
      ctx.moveTo(b3x, b3y); ctx.lineTo(b3x+Math.cos(ba)*b3l, b3y+Math.sin(ba)*b3l);
    }
  }
  ctx.lineWidth = lw;
  ctx.stroke();
  // center hexagon
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i/6)*TAU;
    i===0 ? ctx.moveTo(Math.cos(a)*lw*2.5, Math.sin(a)*lw*2.5)
          : ctx.lineTo(Math.cos(a)*lw*2.5, Math.sin(a)*lw*2.5);
  }
  ctx.closePath(); ctx.fill();
}

/* ── Particle init ───────────────────────────────────────────────────────── */
function initParticles(w, h) {
  const isSnow = _config.shape === "snowflake";
  const layers = isSnow ? SNOW_LAYERS : LAYER_DEFS;
  const total  = Math.round(300 * _config.quantity);
  const dir    = _config.direction;
  const pts    = [];

  for (let li = 0; li < layers.length; li++) {
    const L     = layers[li];
    const count = Math.max(4, Math.round(total * L.countFrac));

    for (let i = 0; i < count; i++) {
      const idx   = pts.length;
      const depth = L.depthMin + Math.random() * (L.depthMax - L.depthMin);
      const sizeT = Math.pow(Math.random(), 1.3);

      let baseSize, vy0;

      if (isSnow) {
        baseSize = (L.sizeMin + sizeT*(L.sizeMax - L.sizeMin)) * _config.sizeRange;
        // Speed range per layer — canvas-fraction per frame
        const spd = L.speedMin + Math.random() * (L.speedMax - L.speedMin);
        vy0 = dir === "up" ? -spd : dir === "still" ? 0 : spd;
      } else {
        baseSize = (L.sizeMin + sizeT*(L.sizeMax - L.sizeMin)) * _config.sizeRange;
        const spd = (0.0008 + depth*0.0014) * (0.6 + Math.random()*0.8);
        vy0 = dir === "up" ? -spd : dir === "still" ? 0 : spd;
        if (_config.shape === "raindrop") vy0 *= (dir==="still" ? 1 : 3.5+depth*2);
        if (_config.shape === "hexagon")  vy0 *= 0.4;
      }

      pts.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx0: (Math.random()-0.5) * 0.0003,
        vy0,
        baseSize,
        depth,
        layer: li,
        renderStyle: L.renderStyle || null,
        swayAmp: L.swayAmp || 0,
        phase:    Math.random() * TAU,
        swayPhase: Math.random() * TAU,
        noiseOff: idx * 2.71 + Math.random() * 50,
        rotAngle: Math.random() * TAU,
        rotSpeed: (L.rotSpeed || 0.002) * (0.5 + Math.random()) * (Math.random()<0.5?1:-1),
        warmth:   0.88 + Math.random() * 0.12,
      });
    }
  }
  pts.sort((a,b) => a.depth - b.depth);
  return pts;
}

/* ── Main render ─────────────────────────────────────────────────────────── */
export function renderBokehSparkle(ctx, w, h, t, bands) {
  if (!_particles || w !== _prevW || h !== _prevH) {
    _particles = initParticles(w, h);
    _prevW = w; _prevH = h;
  }

  const time   = t * 0.001;
  const bass   = bands.bass || 0;
  const minDim = Math.min(w, h);
  const isSnow = _config.shape === "snowflake";
  const layers = isSnow ? SNOW_LAYERS : LAYER_DEFS;

  for (const k of Object.keys(_smoothBands))
    _smoothBands[k] += ((bands[k]||0) - _smoothBands[k]) * 0.1;

  _smoothBass  += (bass - _smoothBass) * 0.05;
  const spike   = Math.max(0, bass - _smoothBass - 0.06);
  _beatImpulse += spike * 4;
  _beatImpulse *= 0.82;

  const dir     = _config.direction;
  const shapeFn = SHAPE_FN[_config.shape];

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let pi = 0; pi < _particles.length; pi++) {
    const p = _particles[pi];
    const L = layers[p.layer];

    let freq = 0;
    for (const fk of L.freqKeys) freq += (_smoothBands[fk]||0);
    freq /= L.freqKeys.length;

    const speedBoost = 1 + freq*0.5 + _beatImpulse*0.12;
    let dy = p.vy0 * h * speedBoost;
    let dx = p.vx0 * h;

    if (isSnow) {
      // ── Layered snow motion ─────────────────────────────
      // Sway: each layer has own amplitude + frequency (near = wider, slower)
      const swayFreq = 0.28 + (1 - p.depth) * 0.15;  // far swings faster
      const sway = Math.sin(time * swayFreq + p.swayPhase) * p.swayAmp
                 + simplex.noise2D(p.noiseOff, time*0.04) * p.swayAmp * 0.4;
      dx += sway * minDim;

      // Gust: occasional speed burst from simplex
      const gust = 1 + simplex.noise2D(p.noiseOff+10, time*0.06) * 0.25;
      dy *= gust;

      // Beat: near flakes react more
      if (_beatImpulse > 0.05)
        dx += simplex.noise2D(p.noiseOff+400, time*2) * _beatImpulse * p.depth * minDim * 0.0004;

    } else if (_config.shape === "raindrop") {
      dx += simplex.noise2D(p.noiseOff, time*0.02) * minDim * 0.00015;

    } else if (_config.shape === "hexagon") {
      dx += simplex.noise2D(p.x/w*2, time*0.06+p.noiseOff)       * minDim * 0.0008;
      const noiseY = simplex.noise2D(p.y/h*2, time*0.06+p.noiseOff+100) * minDim * 0.0006;
      dy  = dir==="still" ? noiseY : dy+noiseY;

    } else {
      dx += simplex.noise2D(p.noiseOff,     time*0.07) * minDim * 0.0005;
      const noiseY = simplex.noise2D(p.noiseOff+200, time*0.07) * minDim * 0.0003;
      dy  = dir==="still" ? noiseY : dy+noiseY;
    }

    if (dir==="still" && !isSnow && _config.shape!=="hexagon" && _config.shape!=="circle")
      dy = simplex.noise2D(p.noiseOff+300, time*0.05) * minDim * 0.0004;

    p.x += dx; p.y += dy;

    const m = p.baseSize * minDim * 3 + 12;
    if (p.y >  h+m)  { p.y = -m;   p.x = Math.random()*w; }
    if (p.y < -m-10) { p.y =  h+m; p.x = Math.random()*w; }
    if (p.x >  w+m)   p.x = -m;
    if (p.x < -m)      p.x =  w+m;

    // Size
    const beatPulse = 1 + _beatImpulse*0.18;
    const breathe   = 1 + Math.sin(time*0.7+p.phase)*0.08;
    const r = p.baseSize * minDim * beatPulse * breathe * (1+freq*0.15);
    if (r < 0.3) continue;

    // Rotation
    p.rotAngle += p.rotSpeed * (1+freq*0.3);

    // Alpha
    const flicker = Math.sin(time*1.5+p.phase)*0.04 + Math.sin(time*3.8+p.noiseOff)*0.02;
    const alpha = Math.min(0.75,
      (L.alphaBase + freq*L.alphaFreq + _beatImpulse*0.04 + flicker) * _config.opacity
    );
    if (alpha < 0.006) continue;

    // Color
    const wR = Math.round(228 + p.warmth*27);
    const wG = Math.round(226 + p.warmth*25 + freq*6);
    const wB = Math.round(218 + p.warmth*22 + p.depth*14);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotAngle);

    if (isSnow) {
      // ── Depth-layered snow rendering ──────────────────────
      const style = p.renderStyle;
      const rgba  = `rgba(${wR},${wG},${wB},${alpha.toFixed(3)})`;

      if (style === "dot") {
        // Far: blurry soft blob — depth-of-field bokeh
        snowDot(ctx, r * 2.2, alpha, wR, wG, wB);

      } else if (style === "simple") {
        // Mid-far: thin arms, subtle glow
        ctx.shadowColor = rgba;
        ctx.shadowBlur  = r * 0.6;
        ctx.strokeStyle = rgba;
        ctx.fillStyle   = rgba;
        ctx.lineCap     = "round";
        snowSimple(ctx, r, Math.max(0.4, r * 0.06));

      } else if (style === "crystal") {
        // Mid-near: full crystal + glow
        ctx.shadowColor = rgba;
        ctx.shadowBlur  = r * 1.0;
        ctx.strokeStyle = rgba;
        ctx.fillStyle   = rgba;
        ctx.lineCap     = "round";
        snowCrystal(ctx, r, Math.max(0.6, r * 0.07));

      } else { // "flake" — near, large, detailed
        // Outer soft aura first
        const aura = ctx.createRadialGradient(0,0,0, 0,0,r*1.8);
        aura.addColorStop(0,   `rgba(${wR},${wG},${wB},${(alpha*0.18).toFixed(3)})`);
        aura.addColorStop(0.5, `rgba(${wR},${wG},${wB},${(alpha*0.07).toFixed(3)})`);
        aura.addColorStop(1,   `rgba(${wR},${wG},${wB},0)`);
        ctx.fillStyle = aura;
        ctx.beginPath(); ctx.arc(0,0,r*1.8,0,TAU); ctx.fill();
        // Crystal
        ctx.shadowColor = `rgba(${wR},${wG},${wB},${(alpha*0.6).toFixed(3)})`;
        ctx.shadowBlur  = r * 1.4;
        ctx.strokeStyle = rgba;
        ctx.fillStyle   = rgba;
        ctx.lineCap     = "round";
        snowFlake(ctx, r, Math.max(0.8, r * 0.075));
      }

    } else {
      // ── Generic filled shape ──────────────────────────────
      const blurFactor = (1-p.depth)*0.5 + 0.5;
      const glowR = r * (1+blurFactor*0.8);
      const g = ctx.createRadialGradient(0,0,0, 0,0,glowR);
      g.addColorStop(0,    `rgba(${wR},${wG},${wB},${(alpha*0.85).toFixed(3)})`);
      g.addColorStop(0.30, `rgba(${wR},${wG},${wB},${(alpha*0.50).toFixed(3)})`);
      g.addColorStop(0.65, `rgba(${wR},${wG},${wB},${(alpha*0.15).toFixed(3)})`);
      g.addColorStop(1,    `rgba(${wR},${wG},${wB},0)`);
      ctx.fillStyle = g;
      shapeFn(ctx, glowR);
      ctx.fill();
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
