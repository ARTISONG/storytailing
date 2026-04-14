// ─── 7. RAIN DROPS — layered rainfall with ripples ───
import { hsl } from "../utils/audio.js";

let _rainDrops = null;
let _ripples = [];

function initRainDrops(w, h) {
  _rainDrops = Array.from({ length: 400 }, (_, i) => ({
    x: Math.random() * w * 1.3 - w * 0.15,
    y: Math.random() * h * 1.5 - h * 0.5,
    speed: 3 + Math.random() * 6,
    length: 8 + Math.random() * 25,
    width: 0.3 + Math.random() * 1.2,
    depth: Math.random(), // 0=far, 1=near
    hue: 200 + Math.random() * 30,
    brightness: 0.2 + Math.random() * 0.8,
    windPhase: Math.random() * Math.PI * 2,
  }));
  _ripples = [];
}

export function resetRainDrops() {
  _rainDrops = null;
  _ripples = [];
}

export function renderRainDrops(ctx, w, h, t, bands) {
  if (!_rainDrops) initRainDrops(w, h);
  const time = t * 0.001;
  const bass = bands.bass||0, sub = bands.subBass||0, mid = bands.mid||0;
  const highMid = bands.highMid||0, pres = bands.presence||0, brill = bands.brilliance||0;
  const overall = bands.overall||0;

  // Audio-reactive parameters
  const intensity = 0.5 + bass * 1.5 + sub * 0.5;
  const windAngle = Math.sin(time * 0.08) * 0.15 + mid * 0.2;
  const glowAmount = brill * 0.5 + pres * 0.3;

  // Subtle ground fog
  const fogGrad = ctx.createLinearGradient(0, h * 0.75, 0, h);
  fogGrad.addColorStop(0, "rgba(0,0,0,0)");
  fogGrad.addColorStop(1, `rgba(40,60,80,${0.06 + overall * 0.06})`);
  ctx.fillStyle = fogGrad;
  ctx.fillRect(0, 0, w, h);

  // Update & draw ripples (from drops hitting bottom)
  _ripples = _ripples.filter(rp => {
    rp.r += rp.speed;
    rp.alpha *= 0.96;
    if (rp.alpha < 0.003) return false;
    ctx.beginPath();
    ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = hsl(rp.hue, 40, 55 + brill * 15, rp.alpha);
    ctx.lineWidth = 0.5 + rp.alpha * 2;
    ctx.stroke();
    if (rp.r > 5) {
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r * 0.6, rp.r * 0.6 * 0.3, 0, 0, Math.PI * 2);
      ctx.strokeStyle = hsl(rp.hue, 35, 50, rp.alpha * 0.5);
      ctx.lineWidth = 0.3;
      ctx.stroke();
    }
    return true;
  });

  // Update & draw rain drops — back to front for depth
  const sorted = [..._rainDrops].sort((a, b) => a.depth - b.depth);

  sorted.forEach((drop, di) => {
    const depthMul = 0.3 + drop.depth * 0.7;
    const dropSpeed = drop.speed * intensity * depthMul;

    const windX = Math.sin(time * 0.5 + drop.windPhase) * 0.5 + windAngle * 3;

    drop.y += dropSpeed;
    drop.x += windX * depthMul;

    const groundY = h * (0.82 + drop.depth * 0.15);
    if (drop.y > groundY) {
      if (Math.random() < 0.4 + bass * 0.4) {
        _ripples.push({
          x: drop.x,
          y: groundY + Math.random() * 5,
          r: 1,
          speed: 0.5 + bass * 1.5 + drop.depth * 0.5,
          alpha: 0.15 + bass * 0.2 + drop.depth * 0.1,
          hue: drop.hue,
        });
      }
      drop.y = -drop.length - Math.random() * h * 0.5;
      drop.x = Math.random() * w * 1.3 - w * 0.15;
    }

    if (drop.x > w + 30) drop.x = -30;
    if (drop.x < -30) drop.x = w + 30;

    const alpha = drop.brightness * (0.25 + overall * 0.35 + glowAmount * 0.2) * depthMul;
    const streakLen = drop.length * (0.8 + bass * 0.6) * depthMul;
    const streakW = (drop.width + 0.5) * depthMul;

    const x1 = drop.x;
    const y1 = drop.y;
    const x2 = drop.x - windX * streakLen * 0.3;
    const y2 = drop.y - streakLen;

    const streakGrad = ctx.createLinearGradient(x2, y2, x1, y1);
    streakGrad.addColorStop(0, hsl(drop.hue, 30, 50, 0));
    streakGrad.addColorStop(0.3, hsl(drop.hue, 35, 55 + brill * 15, alpha * 0.4));
    streakGrad.addColorStop(1, hsl(drop.hue, 40, 65 + brill * 20, alpha));

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = streakGrad;
    ctx.lineWidth = streakW;
    ctx.lineCap = "round";
    ctx.stroke();

    if (drop.depth > 0.6 && glowAmount > 0.1) {
      const tipGlow = ctx.createRadialGradient(x1, y1, 0, x1, y1, streakW * 4);
      tipGlow.addColorStop(0, hsl(drop.hue, 50, 75, alpha * 0.5 * glowAmount));
      tipGlow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = tipGlow;
      ctx.beginPath(); ctx.arc(x1, y1, streakW * 4, 0, Math.PI * 2); ctx.fill();
    }
  });

  // Distant lightning flash on strong bass hits
  if (bass > 0.7 && Math.random() < 0.15) {
    ctx.fillStyle = `rgba(150,170,200,${(bass - 0.7) * 0.06})`;
    ctx.fillRect(0, 0, w, h);
  }
}
