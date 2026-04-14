// ─── 5. DEEP OCEAN PULSE ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

export function renderDeepOcean(ctx, w, h, t, bands) {
  const time = t*0.0003;
  const sub = bands.subBass||0, bass = bands.bass||0, lowMid = bands.lowMid||0;
  const mid = bands.mid||0, pres = bands.presence||0, brill = bands.brilliance||0;
  if (bands.waveform) {
    ctx.beginPath();
    for (let i = 0; i < bands.waveform.length; i++) {
      const y = h*0.75 + (bands.waveform[i]/128-1)*h*0.08*(1+bass*2);
      i===0 ? ctx.moveTo(0,y) : ctx.lineTo(i*(w/bands.waveform.length),y);
    }
    ctx.strokeStyle = hsl(195,60,50,0.04+bass*0.06); ctx.lineWidth=1; ctx.stroke();
  }
  for (let layer = 0; layer < 8; layer++) {
    ctx.beginPath();
    const yB = h*(0.35+layer*0.08);
    for (let x = 0; x <= w; x += 2) {
      const n1 = simplex.noise3D(x*(0.003+layer*0.001),layer*0.5,time+layer*0.3);
      const n2 = simplex.noise2D(x*(0.007-layer*0.0005),time*1.5-layer);
      const amp = 30+sub*80+bass*40;
      const y = yB + n1*amp + n2*amp*0.4 + Math.sin(x*0.004+time*3+layer)*(15+sub*40);
      x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.lineTo(w,h+10); ctx.lineTo(0,h+10); ctx.closePath();
    const hue = 195+layer*5+lowMid*15;
    const alpha = (0.025+sub*0.04)*(1-(layer/8)*0.5);
    const grad = ctx.createLinearGradient(0,yB-60,0,yB+120);
    grad.addColorStop(0,hsl(hue,50+pres*20,35+mid*15,alpha*1.5));
    grad.addColorStop(0.3,hsl(hue+10,45,28+brill*10,alpha));
    grad.addColorStop(1,"rgba(0,0,0,0)"); ctx.fillStyle=grad; ctx.fill();
  }
  for (let i = 0; i < 30; i++) {
    const px = (simplex.noise2D(i*4.7,time*0.8)*0.5+0.5)*w;
    const py = h*0.4+simplex.noise2D(i*9.3,time*0.8+50)*h*0.35;
    const pulse = 0.5+Math.sin(time*8+i*2.3)*0.5;
    const g = ctx.createRadialGradient(px,py,0,px,py,(2+pres*8)*pulse*5);
    g.addColorStop(0,hsl(190,80,70,(0.05+brill*0.25)*pulse)); g.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(px,py,(2+pres*8)*pulse*5,0,Math.PI*2); ctx.fill();
  }
}
