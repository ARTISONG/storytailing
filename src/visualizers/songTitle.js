// ── SONG TITLE RENDERER ──
import { hsl } from "../utils/audio.js";

export function renderSongTitle(ctx, w, h, title, title2, bands, t, pos, fontSizePct, fontSizePct2) {
  if (!title && !title2) return;
  const time = t * 0.001;
  const bass = bands.bass||0, overall = bands.overall||0, brill = bands.brilliance||0, mid = bands.mid||0;
  const sub = bands.subBass||0, pres = bands.presence||0;
  const breathe = Math.sin(time * 0.2) * 4;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const calcFs = (text, pct) => {
    if (!text) return null;
    const targetW = w * (pct / 100);
    let fs = Math.round(w * 0.18);
    ctx.font = `800 ${fs}px "Sarabun", "Cormorant Garamond", sans-serif`;
    let measured = ctx.measureText(text).width;
    if (measured > targetW && measured > 0) fs = Math.round(fs * (targetW / measured));
    fs = Math.max(16, Math.min(fs, h * 0.35));
    ctx.font = `800 ${fs}px "Sarabun", "Cormorant Garamond", sans-serif`;
    measured = ctx.measureText(text).width;
    return { fs, measured, textH: fs * 0.85 };
  };

  const line1 = calcFs(title, fontSizePct);
  const line2 = calcFs(title2, fontSizePct2);

  const gap = line1 && line2 ? Math.max(line1.fs, line2.fs) * 0.2 : 0;
  const totalH = (line1 ? line1.textH : 0) + gap + (line2 ? line2.textH : 0);
  const maxMeasured = Math.max(line1 ? line1.measured : 0, line2 ? line2.measured : 0);

  const pad = Math.max((line1 ? line1.fs : line2 ? line2.fs : 40) * 0.6, 40);
  const posMap = {
    "top-left":      { x: pad + maxMeasured/2,    y: pad + totalH/2 },
    "top-center":    { x: w/2,                     y: pad + totalH/2 },
    "top-right":     { x: w - pad - maxMeasured/2, y: pad + totalH/2 },
    "middle-left":   { x: pad + maxMeasured/2,    y: h/2 },
    "middle-center": { x: w/2,                     y: h/2 },
    "middle-right":  { x: w - pad - maxMeasured/2, y: h/2 },
    "bottom-left":   { x: pad + maxMeasured/2,    y: h - pad - totalH/2 },
    "bottom-center": { x: w/2,                     y: h - pad - totalH/2 },
    "bottom-right":  { x: w - pad - maxMeasured/2, y: h - pad - totalH/2 },
  };
  const anchor = posMap[pos] || posMap["bottom-center"];
  const centerX = anchor.x;
  const centerY = anchor.y + breathe;

  const y1 = line1 && line2 ? centerY - totalH/2 + line1.textH/2 : centerY;
  const y2 = line1 && line2 ? centerY + totalH/2 - line2.textH/2 : centerY;

  const drawLine = (text, info, ty) => {
    if (!text || !info) return;
    const { fs, measured, textH } = info;
    ctx.font = `800 ${fs}px "Sarabun", "Cormorant Garamond", sans-serif`;

    ctx.shadowColor = `rgba(255,255,255,${0.04 + overall * 0.05})`;
    ctx.shadowBlur = 50 + bass * 40;
    ctx.fillStyle = `rgba(150,150,150,${0.01 + overall * 0.01})`;
    ctx.fillText(text, centerX, ty);
    ctx.shadowBlur = 0;

    const shadowOff = 2 + bass * 3;
    ctx.fillStyle = `rgba(0,0,0,${0.15 + overall * 0.1})`;
    ctx.fillText(text, centerX + shadowOff, ty + shadowOff);

    ctx.strokeStyle = `rgba(180,200,220,${0.03 + brill * 0.06 + bass * 0.03})`;
    ctx.lineWidth = 3 + bass * 2;
    ctx.strokeText(text, centerX, ty);

    const gradShift = Math.sin(time * 0.15) * 0.15 + mid * 0.1;
    const tg = ctx.createLinearGradient(centerX - measured/2, 0, centerX + measured/2, 0);
    const bL = 40 + overall * 25, pL = 70 + brill * 25;
    const mA = 0.15 + overall * 0.3 + bass * 0.1;
    tg.addColorStop(0, `rgba(${bL},${bL},${bL},${mA*0.3})`);
    tg.addColorStop(Math.max(0,Math.min(1,0.1+gradShift)), `rgba(${bL+20},${bL+20},${bL+20},${mA*0.6})`);
    tg.addColorStop(Math.max(0,Math.min(1,0.35+gradShift+bass*0.1)), `rgba(${pL},${pL},${pL},${mA})`);
    tg.addColorStop(Math.max(0,Math.min(1,0.65-gradShift+mid*0.05)), `rgba(${pL-10},${pL-10},${pL-10},${mA*0.9})`);
    tg.addColorStop(Math.max(0,Math.min(1,0.9-gradShift)), `rgba(${bL+15},${bL+15},${bL+15},${mA*0.5})`);
    tg.addColorStop(1, `rgba(${bL},${bL},${bL},${mA*0.2})`);
    ctx.fillStyle = tg; ctx.fillText(text, centerX, ty);

    const vg = ctx.createLinearGradient(0, ty - textH/2, 0, ty + textH/2);
    const va = 0.06 + pres * 0.1;
    vg.addColorStop(0, `rgba(220,220,220,${va})`);
    vg.addColorStop(0.35, `rgba(150,150,150,${va*0.4})`);
    vg.addColorStop(0.65, `rgba(80,80,80,${va*0.1})`);
    vg.addColorStop(1, "rgba(40,40,40,0)");
    ctx.fillStyle = vg; ctx.fillText(text, centerX, ty);

    ctx.fillStyle = `rgba(255,255,255,${0.03 + brill * 0.08 + bass * 0.04})`;
    ctx.fillText(text, centerX, ty - 0.5);

    ctx.strokeStyle = `rgba(200,200,200,${0.02 + overall * 0.03})`;
    ctx.lineWidth = 0.5;
    ctx.strokeText(text, centerX, ty);

    if (bass > 0.4) {
      ctx.fillStyle = `rgba(255,255,255,${(bass - 0.4) * 0.15})`;
      ctx.fillText(text, centerX, ty);
    }
  };

  if (line1) drawLine(title, line1, line2 ? y1 : centerY);
  if (line2) drawLine(title2, line2, line1 ? y2 : centerY);

  // ── Enhanced multi-layer reflection ──
  const refInfo = line2 || line1;
  const refText = title2 || title;
  const refTy = line2 ? y2 : centerY;
  if (refInfo) {
    const refY = refTy + refInfo.textH * 0.5;
    ctx.save();
    ctx.translate(0, refY); ctx.scale(1, -1); ctx.translate(0, -refY);
    ctx.font = `800 ${refInfo.fs}px "Sarabun", "Cormorant Garamond", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const rg = ctx.createLinearGradient(0, refTy - refInfo.textH*0.4, 0, refTy + refInfo.textH*0.4);
    rg.addColorStop(0, "rgba(60,60,60,0)");
    rg.addColorStop(0.5, `rgba(120,120,120,${0.02 + overall * 0.03})`);
    rg.addColorStop(1, `rgba(180,180,180,${0.05 + overall * 0.06})`);
    ctx.fillStyle = rg; ctx.fillText(refText, centerX, refTy);
    const rg2 = ctx.createLinearGradient(centerX - refInfo.measured/2, 0, centerX + refInfo.measured/2, 0);
    const rShift = Math.sin(time * 0.2) * 0.2;
    rg2.addColorStop(0, "rgba(100,100,100,0)");
    rg2.addColorStop(Math.max(0,Math.min(1,0.4+rShift)), `rgba(140,140,140,${0.02 + overall * 0.02})`);
    rg2.addColorStop(Math.max(0,Math.min(1,0.6-rShift)), `rgba(140,140,140,${0.02 + overall * 0.02})`);
    rg2.addColorStop(1, "rgba(100,100,100,0)");
    ctx.fillStyle = rg2; ctx.fillText(refText, centerX, refTy);
    ctx.restore();
  }

  ctx.restore();
}
