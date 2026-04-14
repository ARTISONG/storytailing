// ─── 4. COSMIC FLOW FIELD ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

let _flowParts = null;

function initFlowParts(w, h) {
  _flowParts = Array.from({ length: 2000 }, () => ({
    x: Math.random()*w, y: Math.random()*h, px:0, py:0,
    age: Math.random()*200, maxAge: 150+Math.random()*150, speed: 0.3+Math.random()*0.7,
  }));
}

export function resetCosmicFlow() {
  _flowParts = null;
}

export function renderCosmicFlow(ctx, w, h, t, bands) {
  if (!_flowParts) initFlowParts(w, h);
  const time = t * 0.0001;
  const pres = bands.presence||0, mid = bands.mid||0, bass = bands.bass||0, brill = bands.brilliance||0, highMid = bands.highMid||0;
  const fScale = 0.002 + pres * 0.003, fStr = 1.5 + bass * 4 + mid * 2;
  _flowParts.forEach(p => {
    const angle = simplex.noise3D(p.x*fScale, p.y*fScale, time) * Math.PI * 4;
    p.px = p.x; p.py = p.y;
    p.x += Math.cos(angle) * fStr * p.speed; p.y += Math.sin(angle) * fStr * p.speed;
    p.age++;
    if (p.age > p.maxAge || p.x < -20 || p.x > w+20 || p.y < -20 || p.y > h+20) {
      p.x = Math.random()*w; p.y = Math.random()*h; p.px=p.x; p.py=p.y; p.age=0; return;
    }
    const life = 1-p.age/p.maxAge;
    const alpha = life * Math.min(1,p.age/20) * (0.15+pres*0.4+highMid*0.2);
    const hue = 210 + simplex.noise2D(p.x*0.003,p.y*0.003)*40 + mid*30;
    ctx.beginPath(); ctx.moveTo(p.px,p.py); ctx.lineTo(p.x,p.y);
    ctx.strokeStyle = hsl(hue, 50+brill*30, 50+brill*25, alpha);
    ctx.lineWidth = 0.8+bass*2; ctx.stroke();
    if (bass > 0.5) {
      const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,5+bass*8);
      g.addColorStop(0, hsl(hue,80,70,alpha*0.3)); g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x,p.y,5+bass*8,0,Math.PI*2); ctx.fill();
    }
  });
}
