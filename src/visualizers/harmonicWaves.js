// ─── 2. HARMONIC WAVES — smooth layered sound wave dimensions ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

// Accumulated time that audio stretches — persists across frames
let _waveTimeAcc = 0;
let _waveBassSmooth = 0;
let _waveMidSmooth = 0;
let _waveOverallSmooth = 0;

export function resetHarmonicWaves() {
  _waveTimeAcc = 0;
  _waveBassSmooth = 0;
  _waveMidSmooth = 0;
  _waveOverallSmooth = 0;
}

export function renderSilkRibbons(ctx, w, h, t, bands) {
  const dt = 0.016; // ~60fps frame delta
  const bass = bands.bass||0, sub = bands.subBass||0, lowMid = bands.lowMid||0, mid = bands.mid||0;
  const highMid = bands.highMid||0, pres = bands.presence||0, brill = bands.brilliance||0;
  const overall = bands.overall||0;

  // ── Smooth all audio values — no sudden jumps ──
  const smoothing = 0.04; // very slow interpolation
  _waveBassSmooth += (bass - _waveBassSmooth) * smoothing;
  _waveMidSmooth += (mid - _waveMidSmooth) * smoothing;
  _waveOverallSmooth += (overall - _waveOverallSmooth) * smoothing;
  const sBass = _waveBassSmooth;
  const sMid = _waveMidSmooth;
  const sOverall = _waveOverallSmooth;

  // ── Bass stretches time — waves flow faster when bass is strong ──
  const timeStretch = 1 + sBass * 2 + sub * 0.8; // bass = faster flow, not bigger amplitude
  _waveTimeAcc += dt * timeStretch;
  const time = _waveTimeAcc;

  const cy = h / 2;
  const layers = 12;

  // Fixed base amplitude — does NOT jump with audio
  const baseAmplitude = 35;

  for (let li = layers - 1; li >= 0; li--) {
    const layerT = li / (layers - 1);

    // Smooth vertical spread — mid gently fans layers apart
    const spread = 5 + sMid * 8;
    const slowDrift = simplex.noise2D(li * 3.7, time * 0.03) * h * 0.06;
    const baseY = cy + slowDrift + (li - layers/2) * spread;

    // Amplitude: constant base + very gentle audio modulation
    const layerAmp = baseAmplitude * (0.4 + (1-layerT) * 0.6);

    // Wave frequencies & speeds — bass makes them flow, not jump
    const freq1 = 0.002 + li * 0.0003;
    const freq2 = freq1 * 2.2;
    const freq3 = freq1 * 0.4;
    const speed1 = 0.5 + li * 0.08;
    const speed2 = speed1 * 1.4;
    const speed3 = speed1 * 0.3;

    // Gentle noise modulation
    const noiseMod = simplex.noise2D(li * 2.1, time * 0.04) * 0.2;

    const points = [];
    for (let x = -10; x <= w + 10; x += 4) {
      const wave1 = Math.sin(x * freq1 + time * speed1 + li * 0.4) * layerAmp;
      const wave2 = Math.sin(x * freq2 + time * speed2 - li * 0.3) * layerAmp * 0.25;
      const wave3 = Math.sin(x * freq3 + time * speed3 + li * 1.2) * layerAmp * 0.4;
      const envelope = 0.7 + Math.sin(x * 0.001 + time * 0.08 + li) * 0.3;
      const y = baseY + (wave1 + wave2 + wave3) * (1 + noiseMod) * envelope;
      points.push({ x, y });
    }

    // Color — smoothed audio influence
    const hue = 170 + li * 12 + sMid * 15 + Math.sin(time * 0.12 + li) * 8;
    const sat = 50 + pres * 15 + (1-layerT) * 15;
    const light = 35 + (1-layerT) * 20 + brill * 8;
    const alpha = (0.025 + sOverall * 0.04) * (0.3 + (1-layerT) * 0.7);
    const lineWidth = (0.5 + (1-layerT) * 2) * (1 + sOverall * 0.8);

    // Glow band — fixed height, no jumping
    const bandH = (6 + sOverall * 8) * (0.4 + (1-layerT) * 0.6);
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y - bandH) : ctx.lineTo(p.x, p.y - bandH));
    for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i].x, points[i].y + bandH);
    ctx.closePath();
    const bandGrad = ctx.createLinearGradient(0, baseY - bandH * 2, 0, baseY + bandH * 2);
    bandGrad.addColorStop(0, "rgba(0,0,0,0)");
    bandGrad.addColorStop(0.3, hsl(hue, sat, light, alpha * 0.25));
    bandGrad.addColorStop(0.5, hsl(hue, sat + 10, light + 5, alpha * 0.4));
    bandGrad.addColorStop(0.7, hsl(hue, sat, light, alpha * 0.25));
    bandGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bandGrad;
    ctx.fill();

    // Core wave line — smooth quadratic curves
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) { ctx.moveTo(points[i].x, points[i].y); continue; }
      const prev = points[i-1], curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      const cpy = (prev.y + curr.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
    }
    ctx.strokeStyle = hsl(hue, sat + 15, light + 15, alpha * 1.5 + 0.015);
    ctx.lineWidth = lineWidth;
    ctx.shadowColor = hsl(hue, sat + 20, light + 10, 0.2);
    ctx.shadowBlur = 4 + sOverall * 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}
