// ─── 9. NAKHWA FIRE BLOSSOM — Haman Nakhwa Festival (함안 낙화놀이) ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

let _nakhwaEmbers = null;
let _nakhwaWireDrops = [];
let _nakhwaWaterRipples = [];
let _nakhwaSplashSparks = [];
let _nakhwaSteam = [];

export function resetNakhwa() {
  _nakhwaEmbers = null;
  _nakhwaWireDrops = [];
  _nakhwaWaterRipples = [];
  _nakhwaSplashSparks = [];
  _nakhwaSteam = [];
}

export function renderNakhwaFire(ctx, w, h, t, bands) {
  const time = t * 0.001;
  const bass = bands.bass||0, sub = bands.subBass||0, mid = bands.mid||0;
  const highMid = bands.highMid||0, pres = bands.presence||0, brill = bands.brilliance||0;
  const overall = bands.overall||0;

  const waterY = h * 0.92;
  const wireY = h * 0.06;
  const wireCount = 5;

  if (!_nakhwaEmbers) {
    _nakhwaEmbers = [];
    _nakhwaWireDrops = [];
    _nakhwaWaterRipples = [];
  }

  // ── Dark night sky gradient ──
  const skyGrad = ctx.createLinearGradient(0, 0, 0, waterY);
  skyGrad.addColorStop(0, "rgb(3,2,8)");
  skyGrad.addColorStop(0.7, "rgb(8,5,15)");
  skyGrad.addColorStop(1, "rgb(12,8,5)");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, waterY);

  // ── Dark water ──
  const waterGrad = ctx.createLinearGradient(0, waterY, 0, h);
  waterGrad.addColorStop(0, "rgb(5,4,10)");
  waterGrad.addColorStop(0.3, "rgb(3,2,6)");
  waterGrad.addColorStop(1, "rgb(1,1,3)");
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, waterY, w, h - waterY);

  // ── Draw horizontal wires with gentle sag ──
  const windSway = Math.sin(time * 0.3) * 8 + mid * 15;
  for (let wi = 0; wi < wireCount; wi++) {
    const wy = wireY + wi * (waterY * 0.12);
    ctx.beginPath();
    ctx.strokeStyle = `rgba(80,60,30,${0.03 + overall * 0.02})`;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= w; x += 4) {
      const sag = Math.sin((x / w) * Math.PI) * 15 + Math.sin(x * 0.01 + time) * 2;
      const y = wy + sag + windSway * 0.1 * Math.sin(x * 0.005 + wi);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Spawn wisteria-like clusters — drooping racemes of embers from wire
  const maxEmbers = 250;
  const clusterChance = 0.3 + bass * 0.5 + overall * 0.3;
  if (Math.random() < clusterChance && _nakhwaEmbers.length < maxEmbers) {
    const wi = Math.floor(Math.random() * wireCount);
    const anchorX = Math.random() * w;
    const anchorWy = wireY + wi * (waterY * 0.12) + Math.sin((anchorX / w) * Math.PI) * 15;
    const clusterSize = 5 + Math.floor(Math.random() * 7 + bass * 3);
    const clusterHue = 20 + Math.random() * 40;
    const clusterSpread = 8 + Math.random() * 15;
    const racemeLen = 30 + Math.random() * 50 + bass * 20;
    for (let ci = 0; ci < clusterSize && _nakhwaEmbers.length < maxEmbers; ci++) {
      const progress = ci / Math.max(1, clusterSize - 1);
      const taper = 1 - progress * 0.7;
      const ox = (Math.random() - 0.5) * clusterSpread * taper;
      const oy = progress * racemeLen + Math.random() * 5;
      _nakhwaEmbers.push({
        x: anchorX + ox,
        y: anchorWy + oy,
        vx: (Math.random() - 0.5) * 0.4 + windSway * 0.015,
        vy: 0.2 + Math.random() * 0.8 + progress * 0.5,
        life: 0.7 + Math.random() * 0.3,
        decay: 0.0015 + Math.random() * 0.003 + progress * 0.001,
        size: (1.5 + Math.random() * 3.5) * (1 - progress * 0.3),
        hue: clusterHue + (Math.random() - 0.5) * 10,
        bright: 0.4 + Math.random() * 0.5 + (1 - progress) * 0.2,
        flicker: Math.random() * Math.PI * 2,
        spiralDir: Math.random() < 0.5 ? 1 : -1,
        spiralSpeed: 1.5 + Math.random() * 2.5,
        spiralRadius: 0.8 + Math.random() * 2 + taper * 1.5,
        age: 0,
        trail: [],
      });
    }
  }

  // ── Update & draw embers — the falling fire flowers ──
  const gravity = 0.015 + bass * 0.01;
  const wind = Math.sin(time * 0.2) * 0.3 + mid * 0.5;
  const spiralPulse = 1 + bass * 2 + highMid * 1.5;
  const spiralExpand = 1 + mid * 1.5;
  const beatPulse = bass * 0.6 + sub * 0.3;

  _nakhwaEmbers = _nakhwaEmbers.filter(em => {
    em.vy += gravity;
    em.vx += wind * 0.01 + (Math.random() - 0.5) * 0.1;
    em.vx *= 0.99;
    em.x += em.vx;
    em.y += em.vy;
    em.life -= em.decay;
    em.flicker += 0.3;
    em.age += 1;

    em.trail.push({ x: em.x, y: em.y, a: em.life });
    if (em.trail.length > 24) em.trail.shift();

    if (em.y >= waterY - 2) {
      const impactX = em.x;
      const impactSize = em.size;
      const impactBright = em.bright * em.life;

      const ringCount = 2 + (impactSize > 2.5 ? 1 : 0);
      for (let ri = 0; ri < ringCount && _nakhwaWaterRipples.length < 80; ri++) {
        _nakhwaWaterRipples.push({
          x: impactX + (Math.random() - 0.5) * 4,
          y: waterY + Math.random() * 3,
          r: 0.5 + ri * 3,
          speed: 0.4 + impactSize * 0.15 - ri * 0.08,
          alpha: (0.12 + impactBright * 0.15) * (1 - ri * 0.25),
          hue: em.hue,
          type: "ring",
        });
      }

      const sparkCount = 2 + Math.floor(impactSize * 1.5);
      for (let si = 0; si < sparkCount && _nakhwaSplashSparks.length < 60; si++) {
        const angle = -Math.PI * 0.2 - Math.random() * Math.PI * 0.6;
        const speed = 1 + Math.random() * 2.5 + impactSize * 0.5;
        _nakhwaSplashSparks.push({
          x: impactX + (Math.random() - 0.5) * 6,
          y: waterY - 1,
          vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1),
          vy: Math.sin(angle) * speed,
          life: 0.6 + Math.random() * 0.4,
          decay: 0.015 + Math.random() * 0.02,
          size: 0.3 + Math.random() * 0.8,
          hue: em.hue + Math.random() * 15 - 5,
          bright: impactBright,
        });
      }

      if (impactSize > 1.5 && _nakhwaSteam.length < 30) {
        _nakhwaSteam.push({
          x: impactX,
          y: waterY - 2,
          vy: -0.2 - Math.random() * 0.5,
          vx: (Math.random() - 0.5) * 0.3,
          size: 5 + impactSize * 3 + Math.random() * 8,
          life: 0.7 + Math.random() * 0.3,
          decay: 0.005 + Math.random() * 0.005,
          hue: em.hue + 10,
        });
      }

      return false;
    }

    if (em.life <= 0 || em.x < -20 || em.x > w + 20) return false;

    const flick = 0.6 + Math.sin(em.flicker) * 0.4;
    const alpha = Math.min(1, em.life * em.bright * flick * (1 + beatPulse));
    const sat = 70 + brill * 20;
    const lit = 55 + em.bright * 25 + brill * 15 + beatPulse * 20;
    const coreR = em.size * (0.5 + flick * 0.5);

    // ── Multi-dimensional comet trail (4D Lissajous + golden ratio) ──
    if (em.trail.length > 3) {
      const tailLen = em.trail.length;
      const PHI = 1.618033988749895;
      const PHI2 = PHI * PHI;
      const PHI3 = PHI2 * PHI;

      for (let strand = 0; strand < 3; strand++) {
        ctx.beginPath();
        let first = true;
        for (let ti = 0; ti < tailLen; ti++) {
          const tp = em.trail[ti];
          const progress = ti / (tailLen - 1);
          const tau = (em.age - (tailLen - ti)) * 0.08 * em.spiralSpeed * spiralPulse;
          const envelope = Math.pow(progress, 0.6);
          const phaseOff = strand * Math.PI * 2 / 3;
          const w1 = Math.cos(tau * PHI + phaseOff) * Math.cos(tau * PHI2 * 0.5);
          const w2 = Math.sin(tau * PHI + phaseOff) * Math.sin(tau * PHI3 * 0.3);
          const denom = 1 + 0.3 * w2;
          const projX = w1 / denom;
          const projY = w2 / (1 + 0.3 * w1);
          const radius = em.spiralRadius * spiralExpand * em.size * 0.7 * (0.3 + envelope * 0.7);
          const ox = projX * radius * em.spiralDir;
          const oy = projY * radius * 0.65;

          const px = tp.x + ox;
          const py = tp.y + oy;
          if (first) { ctx.moveTo(px, py); first = false; }
          else ctx.lineTo(px, py);
        }
        const strandAlpha = alpha * (0.25 - strand * 0.07);
        const strandHue = em.hue + strand * 12 - 8;
        const strandWidth = em.size * (0.6 - strand * 0.15);
        ctx.strokeStyle = hsl(strandHue, 75 + strand * 5, 58 + brill * 12, strandAlpha);
        ctx.lineWidth = strandWidth;
        ctx.stroke();
      }

      // Luminous center trail — Catmull-Rom spline
      ctx.beginPath();
      for (let ti = 0; ti < tailLen; ti++) {
        const tp = em.trail[ti];
        if (ti === 0) ctx.moveTo(tp.x, tp.y);
        else if (ti < tailLen - 1) {
          const next = em.trail[ti + 1];
          const mx = (tp.x + next.x) / 2;
          const my = (tp.y + next.y) / 2;
          ctx.quadraticCurveTo(tp.x, tp.y, mx, my);
        } else {
          ctx.lineTo(tp.x, tp.y);
        }
      }
      ctx.strokeStyle = hsl(em.hue - 5, 60, 80, alpha * 0.15);
      ctx.lineWidth = em.size * 0.15;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(em.x, em.y, coreR * 5, 0, Math.PI * 2);
    ctx.fillStyle = hsl(em.hue, 80, 55, alpha * 0.06 + beatPulse * 0.03);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(em.x, em.y, coreR * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = hsl(em.hue, 85, 60, alpha * 0.12 + beatPulse * 0.05);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(em.x, em.y, coreR, 0, Math.PI * 2);
    ctx.fillStyle = hsl(em.hue, sat, Math.min(95, lit), alpha);
    ctx.fill();

    if (beatPulse > 0.3 && em.size > 1.5) {
      ctx.beginPath();
      ctx.arc(em.x, em.y, coreR * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = hsl(em.hue - 10, 40, 95, alpha * beatPulse * 0.6);
      ctx.fill();
    }

    return true;
  });

  // ── Water surface — subtle shimmer line ──
  ctx.beginPath();
  for (let x = 0; x <= w; x += 3) {
    const waveY = waterY + Math.sin(x * 0.02 + time * 0.8) * 1.5 + Math.sin(x * 0.007 + time * 0.3) * 3;
    x === 0 ? ctx.moveTo(x, waveY) : ctx.lineTo(x, waveY);
  }
  ctx.strokeStyle = `rgba(255,180,80,${0.015 + overall * 0.02})`;
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // ── Water warm glow from embers above ──
  const warmGlow = ctx.createLinearGradient(0, waterY, 0, h);
  warmGlow.addColorStop(0, `rgba(255,160,50,${0.03 + overall * 0.04 + bass * 0.02})`);
  warmGlow.addColorStop(0.5, `rgba(200,100,20,${0.01 + overall * 0.02})`);
  warmGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = warmGlow;
  ctx.fillRect(0, waterY, w, h - waterY);

  // ── Water ripples ──
  _nakhwaWaterRipples = _nakhwaWaterRipples.filter(rp => {
    rp.r += rp.speed;
    rp.alpha *= 0.95;
    if (rp.alpha < 0.002) return false;
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = hsl(rp.hue, 60, 55, rp.alpha);
    ctx.lineWidth = 0.5 + rp.alpha * 2;
    ctx.stroke();
    if (rp.r > 4) {
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r * 0.5, rp.r * 0.5 * 0.3, 0, 0, Math.PI * 2);
      ctx.strokeStyle = hsl(rp.hue - 5, 50, 65, rp.alpha * 0.4);
      ctx.lineWidth = 0.3;
      ctx.stroke();
    }
    return true;
  });

  // ── Splash sparks ──
  _nakhwaSplashSparks = _nakhwaSplashSparks.filter(sp => {
    sp.vy += 0.06;
    sp.x += sp.vx;
    sp.y += sp.vy;
    sp.life -= sp.decay;
    if (sp.life <= 0 || sp.y > waterY + 5) return false;
    const sa = sp.life * sp.bright;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
    ctx.fillStyle = hsl(sp.hue, 80, 70, sa);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.size * 3, 0, Math.PI * 2);
    ctx.fillStyle = hsl(sp.hue, 70, 55, sa * 0.15);
    ctx.fill();
    return true;
  });

  // ── Steam wisps ──
  _nakhwaSteam = _nakhwaSteam.filter(st => {
    st.y += st.vy;
    st.x += st.vx + Math.sin(time * 2 + st.x * 0.01) * 0.15;
    st.size += 0.3;
    st.life -= st.decay;
    if (st.life <= 0) return false;
    const sa = st.life * 0.04;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.size, 0, Math.PI * 2);
    ctx.fillStyle = hsl(st.hue, 40, 50, sa);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.size * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = hsl(st.hue + 10, 30, 40, sa * 0.3);
    ctx.fill();
    return true;
  });

  // ── Overall warm ambient glow on water ──
  const ambGlow = ctx.createLinearGradient(0, waterY, 0, h);
  ambGlow.addColorStop(0, `rgba(255,160,50,${0.02 + overall * 0.03 + bass * 0.02})`);
  ambGlow.addColorStop(1, `rgba(100,50,10,${0.005 + overall * 0.005})`);
  ctx.fillStyle = ambGlow;
  ctx.fillRect(0, waterY, w, h - waterY);

  // ── Faint stars in dark sky ──
  for (let i = 0; i < 15; i++) {
    const sx = (simplex.noise2D(i * 17.3, 0.1) * 0.5 + 0.5) * w;
    const sy = (simplex.noise2D(0.1, i * 13.7) * 0.5 + 0.5) * waterY * 0.5;
    const tw = 0.3 + Math.sin(time * 0.5 + i * 4.1) * 0.3;
    ctx.fillStyle = `rgba(200,180,150,${0.02 * tw + brill * 0.03})`;
    ctx.beginPath(); ctx.arc(sx, sy, 0.5 + tw * 0.5, 0, Math.PI * 2); ctx.fill();
  }

  // ── Wind-blown sparkles (procedural, no state) ──
  const sparkleCount = 40 + Math.floor(bass * 30);
  const windDir = Math.sin(time * 0.15) * 2 + mid * 3;
  for (let i = 0; i < sparkleCount; i++) {
    const seed = i * 7.31;
    const phase = simplex.noise2D(seed, time * 0.2);
    const phase2 = simplex.noise2D(seed + 100, time * 0.15);
    const baseX = (simplex.noise2D(seed, 0.5) * 0.5 + 0.5) * w;
    const baseY = (simplex.noise2D(0.5, seed) * 0.5 + 0.5) * waterY * 0.95;
    const sx = baseX + Math.sin(time * 0.8 + seed) * 30 + windDir * (10 + phase * 15);
    const sy = baseY + Math.cos(time * 0.5 + seed * 1.3) * 20 + phase2 * 15;
    const wx = ((sx % w) + w) % w;
    if (sy < 0 || sy > waterY) continue;
    const twinkle = Math.sin(time * 3 + seed * 5) * 0.5 + 0.5;
    const sparkAlpha = (0.03 + twinkle * 0.08 + beatPulse * 0.15 + brill * 0.06) * (0.5 + phase * 0.5);
    const sparkSize = 0.3 + twinkle * 0.8 + beatPulse * 0.5;
    const sparkHue = 30 + phase * 20;
    ctx.beginPath();
    ctx.arc(wx, sy, sparkSize * 3, 0, Math.PI * 2);
    ctx.fillStyle = hsl(sparkHue, 70, 60, sparkAlpha * 0.3);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(wx, sy, sparkSize, 0, Math.PI * 2);
    ctx.fillStyle = hsl(sparkHue, 80, 75 + beatPulse * 15, sparkAlpha);
    ctx.fill();
  }
}
