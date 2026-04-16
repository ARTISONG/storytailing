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

/* ── Generic layers (circle / hexagon / raindrop) ────────────────────────── */
const LAYER_DEFS = [
  { freqKeys:["subBass","bass"],     depthMin:0.00, depthMax:0.25, sizeMin:0.012, sizeMax:0.030, countFrac:0.18, alphaBase:0.08, alphaFreq:0.14 },
  { freqKeys:["lowMid","mid"],       depthMin:0.20, depthMax:0.50, sizeMin:0.006, sizeMax:0.018, countFrac:0.30, alphaBase:0.10, alphaFreq:0.18 },
  { freqKeys:["highMid","presence"], depthMin:0.45, depthMax:0.75, sizeMin:0.002, sizeMax:0.010, countFrac:0.30, alphaBase:0.13, alphaFreq:0.22 },
  { freqKeys:["brilliance"],         depthMin:0.70, depthMax:1.00, sizeMin:0.001, sizeMax:0.006, countFrac:0.22, alphaBase:0.16, alphaFreq:0.28 },
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

/* ── Generic shape functions (non-snow) ──────────────────────────────────── */
function drawCircle(ctx,r){ctx.beginPath();ctx.arc(0,0,r,0,TAU);}
function drawHexagon(ctx,r){ctx.beginPath();for(let i=0;i<6;i++){const a=(i/6)*TAU-Math.PI/6;i===0?ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r):ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();}
function drawRaindrop(ctx,r){ctx.beginPath();ctx.arc(0,r*0.2,r*0.55,0.3,Math.PI-0.3,false);ctx.lineTo(0,-r*0.95);ctx.closePath();}
const SHAPE_FN={circle:drawCircle,hexagon:drawHexagon,raindrop:drawRaindrop};

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
  const layers = isSnow ? SNOW_LAYERS : LAYER_DEFS;
  const total  = Math.round(280 * _config.quantity);
  const dir    = _config.direction;
  const pts    = [];

  for (let li=0; li<layers.length; li++) {
    const L = layers[li];
    const count = Math.max(4, Math.round(total * L.countFrac));
    for (let i=0; i<count; i++) {
      const idx   = pts.length;
      const depth = L.depthMin + Math.random()*(L.depthMax-L.depthMin);
      const sizeT = Math.pow(Math.random(), 1.3);
      const baseSize = (L.sizeMin + sizeT*(L.sizeMax-L.sizeMin)) * _config.sizeRange;

      let vy0;
      if (isSnow) {
        const spd = L.speedMin + Math.random()*(L.speedMax-L.speedMin);
        vy0 = dir==="up" ? -spd : dir==="still" ? 0 : spd;
      } else {
        const spd = (0.0008+depth*0.0014)*(0.6+Math.random()*0.8);
        vy0 = dir==="up" ? -spd : dir==="still" ? 0 : spd;
        if (_config.shape==="raindrop") vy0 *= (dir==="still"?1:3.5+depth*2);
        if (_config.shape==="hexagon")  vy0 *= 0.4;
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

  const isSnow = _config.shape==="snowflake";
  if (isSnow) buildSprites();   // no-op after first call

  const time   = t*0.001;
  const bass   = bands.bass||0;
  const minDim = Math.min(w,h);
  const layers = isSnow ? SNOW_LAYERS : LAYER_DEFS;
  const dir    = _config.direction;

  for (const k of Object.keys(_smoothBands))
    _smoothBands[k] += ((bands[k]||0)-_smoothBands[k])*0.1;

  _smoothBass  += (bass-_smoothBass)*0.05;
  const spike   = Math.max(0, bass-_smoothBass-0.06);
  _beatImpulse += spike*4; _beatImpulse *= 0.82;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let pi=0; pi<_particles.length; pi++) {
    const p = _particles[pi];
    const L = layers[p.layer];

    let freq=0;
    for (const fk of L.freqKeys) freq+=(_smoothBands[fk]||0);
    freq /= L.freqKeys.length;

    // ── Movement ─────────────────────────────────────────────
    const speedBoost = 1 + freq*0.45 + _beatImpulse*0.10;
    let dy = p.vy0*h*speedBoost;
    let dx = p.vx0*h;

    if (isSnow) {
      // Smooth sway per particle — sine only, noise is small correction
      const sway = Math.sin(time*p.swayFreq + p.swayPhase)
                 + simplex.noise2D(p.noiseOff, time*0.025) * 0.3;
      dx += sway * p.swayAmp * minDim;
      dy *= 1 + simplex.noise2D(p.noiseOff+10, time*0.04)*0.15;
      if (_beatImpulse > 0.05)
        dx += simplex.noise2D(p.noiseOff+400, time*1.5)*_beatImpulse*p.depth*minDim*0.0003;
      if (dir==="still")
        dy = simplex.noise2D(p.noiseOff+300, time*0.03)*minDim*0.00030;
    } else if (_config.shape==="raindrop") {
      dx += simplex.noise2D(p.noiseOff, time*0.02)*minDim*0.00012;
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
      ctx.rotate(p.rotAngle);
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, -dim/2, -dim/2, dim, dim);

    } else {
      // ── Generic filled shape ──────────────────────────────
      ctx.translate(p.x, p.y);
      const shapeFn = SHAPE_FN[_config.shape]||drawCircle;
      const blurFactor = (1-p.depth)*0.5+0.5;
      const glowR = r*(1+blurFactor*0.8);
      const wR=Math.round(228+p.depth*27), wG=Math.round(226+freq*6), wB=Math.round(220+p.depth*14);
      const g = ctx.createRadialGradient(0,0,0,0,0,glowR);
      g.addColorStop(0,   `rgba(${wR},${wG},${wB},${(alpha*0.85).toFixed(3)})`);
      g.addColorStop(0.30,`rgba(${wR},${wG},${wB},${(alpha*0.50).toFixed(3)})`);
      g.addColorStop(0.65,`rgba(${wR},${wG},${wB},${(alpha*0.15).toFixed(3)})`);
      g.addColorStop(1,   `rgba(${wR},${wG},${wB},0)`);
      ctx.fillStyle=g; shapeFn(ctx,glowR); ctx.fill();
      if (p.depth>0.5 && r>minDim*0.002) {
        ctx.fillStyle=`rgba(255,255,255,${(alpha*0.35).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(0,0,r*0.18,0,TAU); ctx.fill();
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
  delete _sprites.dot; delete _sprites.simple; delete _sprites.crystal; delete _sprites.flake;
}
