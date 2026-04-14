// ─── 8. AMBIENT SPECTRUM — organic audio visualizer ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

let _specSmooth = null;

export function resetAmbientSpectrum() {
  _specSmooth = null;
}

export function renderAmbientSpectrum(ctx, w, h, t, bands) {
  const time = t * 0.001;
  const bass = bands.bass||0, sub = bands.subBass||0, mid = bands.mid||0;
  const highMid = bands.highMid||0, pres = bands.presence||0, brill = bands.brilliance||0;
  const overall = bands.overall||0;

  const barCount = 64;
  const mirrorY = h;
  const maxBarH = h * 0.4;
  const barSpacing = w * 0.75 / barCount;
  const barW = barSpacing * 0.55;
  const startX = (w - barCount * barSpacing) / 2;

  // Initialize smoothing
  if (!_specSmooth || _specSmooth.length !== barCount) {
    _specSmooth = new Array(barCount).fill(0);
  }

  // Ambient background glow based on overall energy
  const bgGlow = ctx.createRadialGradient(w/2, mirrorY, 0, w/2, mirrorY, w * 0.5);
  bgGlow.addColorStop(0, `rgba(40,80,140,${0.01 + overall * 0.02})`);
  bgGlow.addColorStop(0.5, `rgba(20,50,100,${0.005 + overall * 0.01})`);
  bgGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = bgGlow;
  ctx.fillRect(0, 0, w, h);

  // Compute bar heights from frequency bands — smooth bell curve per band
  for (let i = 0; i < barCount; i++) {
    const norm = i / (barCount - 1);

    let val = 0;
    if (norm < 0.08) val = sub * 0.8 + bass * 0.2;
    else if (norm < 0.2) val = bass * 0.7 + sub * 0.15 + mid * 0.15;
    else if (norm < 0.35) val = bass * 0.3 + mid * 0.5 + highMid * 0.2;
    else if (norm < 0.55) val = mid * 0.6 + highMid * 0.3 + bass * 0.1;
    else if (norm < 0.7) val = highMid * 0.5 + mid * 0.2 + pres * 0.3;
    else if (norm < 0.85) val = pres * 0.6 + highMid * 0.2 + brill * 0.2;
    else val = brill * 0.5 + pres * 0.3 + highMid * 0.2;

    val += simplex.noise2D(i * 0.3, time * 0.5) * 0.15;
    val = Math.max(0.02, Math.min(1, val));

    const target = val;
    const attack = 0.08;
    const release = 0.03;
    _specSmooth[i] += (target - _specSmooth[i]) * (target > _specSmooth[i] ? attack : release);
  }

  // Draw bars — back layer (wide glow), then front layer (sharp bar)
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < barCount; i++) {
      const norm = i / (barCount - 1);
      const val = _specSmooth[i];
      const x = startX + i * barSpacing;
      const barH = val * maxBarH;

      const hue = 210 + norm * 40 + mid * 10;
      const sat = 40 + pres * 20 + norm * 10;
      const light = 35 + val * 25 + brill * 10;

      if (pass === 0) {
        const glowW = barW * 3;
        const glowGrad = ctx.createLinearGradient(0, mirrorY - barH, 0, mirrorY);
        glowGrad.addColorStop(0, hsl(hue, sat - 10, light + 10, 0));
        glowGrad.addColorStop(0.3, hsl(hue, sat, light, val * 0.04 + 0.005));
        glowGrad.addColorStop(1, hsl(hue, sat + 10, light + 5, val * 0.06 + 0.01));
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        const r = glowW / 2;
        ctx.moveTo(x - glowW/2 + r, mirrorY - barH);
        ctx.arcTo(x + glowW/2, mirrorY - barH, x + glowW/2, mirrorY, r);
        ctx.lineTo(x + glowW/2, mirrorY);
        ctx.lineTo(x - glowW/2, mirrorY);
        ctx.arcTo(x - glowW/2, mirrorY - barH, x - glowW/2 + r, mirrorY - barH, r);
        ctx.closePath();
        ctx.fill();
      } else {
        const alpha = 0.08 + val * 0.2 + overall * 0.05;
        const barGrad = ctx.createLinearGradient(0, mirrorY - barH, 0, mirrorY);
        barGrad.addColorStop(0, hsl(hue, sat + 15, light + 20, alpha * 0.6));
        barGrad.addColorStop(0.3, hsl(hue, sat + 10, light + 10, alpha));
        barGrad.addColorStop(0.8, hsl(hue, sat + 5, light, alpha * 0.8));
        barGrad.addColorStop(1, hsl(hue, sat, light - 5, alpha * 0.9));
        ctx.fillStyle = barGrad;

        const r = Math.min(barW / 2, 4);
        ctx.beginPath();
        ctx.moveTo(x - barW/2 + r, mirrorY - barH);
        ctx.arcTo(x + barW/2, mirrorY - barH, x + barW/2, mirrorY, r);
        ctx.lineTo(x + barW/2, mirrorY);
        ctx.lineTo(x - barW/2, mirrorY);
        ctx.arcTo(x - barW/2, mirrorY - barH, x - barW/2 + r, mirrorY - barH, r);
        ctx.closePath();
        ctx.fill();

        // Bright cap at top
        const capH = 2 + val * 3;
        ctx.fillStyle = hsl(hue, sat + 20, light + 25, alpha * 1.5);
        ctx.beginPath();
        ctx.moveTo(x - barW/2 + r, mirrorY - barH);
        ctx.arcTo(x + barW/2, mirrorY - barH, x + barW/2, mirrorY - barH + capH, r);
        ctx.lineTo(x + barW/2, mirrorY - barH + capH);
        ctx.lineTo(x - barW/2, mirrorY - barH + capH);
        ctx.arcTo(x - barW/2, mirrorY - barH, x - barW/2 + r, mirrorY - barH, r);
        ctx.closePath();
        ctx.fill();

        if (barH > 5) {
          const upGlow = ctx.createLinearGradient(0, mirrorY - barH - barH * 0.3, 0, mirrorY - barH);
          upGlow.addColorStop(0, hsl(hue, sat, light + 15, 0));
          upGlow.addColorStop(1, hsl(hue, sat, light + 10, alpha * 0.3));
          ctx.fillStyle = upGlow;
          ctx.fillRect(x - barW, mirrorY - barH - barH * 0.3, barW * 2, barH * 0.3);
        }
      }
    }
  }

  // Floating particles above spectrum — ambient dust
  for (let i = 0; i < 25; i++) {
    const px = w * (simplex.noise2D(i * 6.3, time * 0.1) * 0.5 + 0.5);
    const py = h * 0.3 + simplex.noise2D(i * 11.7, time * 0.1 + 50) * h * 0.4;
    const tw = 0.5 + Math.sin(time * 1.5 + i * 2.9) * 0.5;
    const ps = 0.5 + brill * 2;
    ctx.fillStyle = hsl(220, 30, 70, (0.02 + brill * 0.08) * tw);
    ctx.beginPath(); ctx.arc(px, py, ps, 0, Math.PI * 2); ctx.fill();
  }
}
