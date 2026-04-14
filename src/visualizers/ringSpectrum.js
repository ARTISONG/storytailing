// ─── 10. RING SPECTRUM — ฉัพพรรณรังสี Sun Ray from single origin ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

let _ringSmooth = null;
let _ringBeatSmooth = 0;
let _ringDbSmooth = 0;

const AURA_LAYERS = [
  { name:"นีล",     rgb:[89,199,107],  bandStart:0,    bandEnd:0.17 },
  { name:"ปีต",     rgb:[235,204,51],  bandStart:0.14, bandEnd:0.33 },
  { name:"โลหิต",   rgb:[217,56,51],   bandStart:0.28, bandEnd:0.50 },
  { name:"โอทาต",   rgb:[220,225,235], bandStart:0.42, bandEnd:0.65 },
  { name:"มัญเชฐ",  rgb:[242,115,38],  bandStart:0.58, bandEnd:0.82 },
  { name:"ประภัสสร", rgb:[191,217,242], bandStart:0.75, bandEnd:1.00 },
];

export function resetRingSpectrum() {
  _ringSmooth = null;
  _ringBeatSmooth = 0;
  _ringDbSmooth = 0;
}

export function renderRingSpectrum(ctx, w, h, t, bands) {
  const time = t * 0.001;
  const bass = bands.bass||0, sub = bands.subBass||0, mid = bands.mid||0;
  const highMid = bands.highMid||0, pres = bands.presence||0, brill = bands.brilliance||0;
  const overall = bands.overall||0, lowMid = bands.lowMid||0;
  const cx = w / 2, cy = h / 2;
  const PHI = 1.618033988749895;

  // Beat + dB smoothing
  const beatTarget = bass * 0.7 + sub * 0.3;
  _ringBeatSmooth += (beatTarget - _ringBeatSmooth) * (beatTarget > _ringBeatSmooth ? 0.3 : 0.04);
  _ringDbSmooth += (overall - _ringDbSmooth) * 0.06;
  const sceneBright = 0.4 + _ringDbSmooth * 0.6;
  const beatPulse = _ringBeatSmooth;

  const minDim = Math.min(w, h);
  const originR = minDim * 0.06 + beatPulse * minDim * 0.01;
  const breathe = Math.sin(time * 0.25) * 3;

  const barCount = 90;
  if (!_ringSmooth || _ringSmooth.length !== barCount) _ringSmooth = new Array(barCount).fill(0);

  const bandArr = [sub, bass, lowMid, mid, highMid, pres, brill];
  const bandPos = [0, 0.14, 0.28, 0.43, 0.57, 0.71, 0.86];

  function freqAt(norm) {
    for (let b = 0; b < 6; b++) {
      if (norm <= bandPos[b + 1]) {
        const t = (norm - bandPos[b]) / (bandPos[b + 1] - bandPos[b]);
        return bandArr[b] * (1 - t) + bandArr[b + 1] * t;
      }
    }
    return bandArr[6];
  }

  for (let i = 0; i < barCount; i++) {
    const norm = i / barCount;
    let val = freqAt(norm);
    val += Math.sin(norm * Math.PI * 4 + time * 0.5) * 0.05 * mid;
    val += simplex.noise2D(i * 0.3 + time * 0.1, norm * 5) * 0.08;
    val = Math.max(0.01, Math.min(1, val));
    _ringSmooth[i] += (val - _ringSmooth[i]) * (val > _ringSmooth[i] ? 0.12 : 0.03);
  }

  const angleStep = (Math.PI * 2) / barCount;

  // ── Center core glow ──
  const coreGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, originR * 3);
  coreGlow.addColorStop(0, `rgba(255,250,240,${0.06 * sceneBright + beatPulse * 0.06})`);
  coreGlow.addColorStop(0.3, `rgba(220,200,180,${0.02 * sceneBright})`);
  coreGlow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = coreGlow;
  ctx.beginPath(); ctx.arc(cx, cy, originR * 3, 0, Math.PI * 2); ctx.fill();

  // ── Draw 6 aura layers ──
  for (let li = 0; li < 6; li++) {
    const layer = AURA_LAYERS[li];
    const [lr, lg, lb] = layer.rgb;

    const layerLenScale = 0.3 + (li / 5) * 0.7;
    const maxLen = minDim * 0.35 * layerLenScale * Math.pow(PHI, li * 0.15);
    const maxLenBeat = maxLen * (1 + beatPulse * 0.3);

    const fibAngle = li * Math.PI * 2 * PHI;
    const layerRot = time * (0.008 + li * 0.003) * (li % 2 === 0 ? 1 : -1) + fibAngle;

    const bStart = layer.bandStart;
    const bEnd = layer.bandEnd;
    const bRange = bEnd - bStart;
    const layerE = freqAt((bStart + bEnd) / 2);

    // ── Ring circle at origin ──
    ctx.beginPath();
    ctx.arc(cx, cy, originR + breathe, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${lr},${lg},${lb},${(0.02 + layerE * 0.04) * sceneBright})`;
    ctx.lineWidth = 0.3 + layerE * 0.5;
    ctx.stroke();

    // ── Sun rays ──
    for (let i = 0; i < barCount; i++) {
      const barNorm = i / barCount;
      const angle = i * angleStep + layerRot;

      const freqNorm = bStart + barNorm * bRange;
      const freqNormWrapped = ((freqNorm - 1) % 1 + 1) % 1;
      const val = _ringSmooth[Math.floor(freqNormWrapped * barCount) % barCount];

      const harmonic1 = Math.sin(angle * 3 * PHI + time * 0.4) * 0.15;
      const harmonic2 = Math.cos(angle * 5 * PHI * PHI + time * 0.25) * 0.08;
      const harmonic3 = Math.sin(angle * 7 + time * 0.15 * PHI) * 0.05;
      const harmonicMod = 1 + (harmonic1 + harmonic2 + harmonic3) * (0.5 + layerE);

      const noiseEnv = 0.7 + simplex.noise2D(
        Math.cos(angle) * 2 + time * 0.08,
        Math.sin(angle) * 2 + li * 3
      ) * 0.3;

      const barLen = val * maxLenBeat * harmonicMod * noiseEnv;
      if (barLen < 1) continue;

      const x1 = cx + Math.cos(angle) * (originR + breathe);
      const y1 = cy + Math.sin(angle) * (originR + breathe);
      const x2 = cx + Math.cos(angle) * (originR + breathe + barLen);
      const y2 = cy + Math.sin(angle) * (originR + breathe + barLen);

      const barAlpha = (0.08 + val * 0.25 + beatPulse * 0.1) * sceneBright * (0.6 + layerLenScale * 0.4);

      // Pass 1: Wide soft glow ray
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},${barAlpha * 0.3})`;
      ctx.lineWidth = 4 + val * 5 + beatPulse * 3;
      ctx.lineCap = "round";
      ctx.stroke();

      // Pass 2: Sharp core ray
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${lr},${lg},${lb},${barAlpha})`;
      ctx.lineWidth = 1 + val * 2;
      ctx.lineCap = "round";
      ctx.stroke();

      // Tip bloom
      if (val > 0.2) {
        const tipR = 1 + val * 2.5 + beatPulse * 1.5;
        ctx.beginPath();
        ctx.arc(x2, y2, tipR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${Math.min(255,lr+60)},${Math.min(255,lg+60)},${Math.min(255,lb+60)},${barAlpha * 0.5})`;
        ctx.fill();
      }
    }

    // ── Layer halo ──
    const avgReach = originR + maxLenBeat * layerE * 0.5;
    const haloGrad = ctx.createRadialGradient(cx, cy, avgReach * 0.7, cx, cy, avgReach * 1.3);
    haloGrad.addColorStop(0, `rgba(${lr},${lg},${lb},${0.004 * sceneBright + layerE * 0.006})`);
    haloGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = haloGrad;
    ctx.beginPath(); ctx.arc(cx, cy, avgReach * 1.3, 0, Math.PI * 2); ctx.fill();
  }

  // ── ประภัสสร outer shimmer ──
  for (let i = 0; i < 30; i++) {
    const seed = i * 7.13;
    const orbitR = originR + minDim * 0.35 * (0.5 + simplex.noise2D(seed, time * 0.1) * 0.5);
    const pAngle = time * 0.04 * (i % 2 === 0 ? 1 : -1) + seed;
    const wobble = simplex.noise2D(seed + 50, time * 0.3) * 8;
    const px = cx + Math.cos(pAngle) * (orbitR + wobble);
    const py = cy + Math.sin(pAngle) * (orbitR + wobble);
    const rainbowHue = (pAngle * 180 / Math.PI + time * 20) % 360;
    const tw = 0.5 + Math.sin(time * 2 + seed * 3) * 0.5;
    const pAlpha = tw * 0.06 * sceneBright + beatPulse * 0.03;
    const pSize = 0.5 + tw * 1.5 + beatPulse * 1;
    ctx.beginPath();
    ctx.arc(px, py, pSize * 3, 0, Math.PI * 2);
    ctx.fillStyle = hsl(rainbowHue, 60, 65, pAlpha * 0.4);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, pSize, 0, Math.PI * 2);
    ctx.fillStyle = hsl(rainbowHue, 70, 75, pAlpha);
    ctx.fill();
  }

  // ── Center beat flash ──
  if (beatPulse > 0.2) {
    const pulseR = originR * (1.5 + beatPulse * 2);
    const pg = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
    pg.addColorStop(0, `rgba(255,250,240,${0.06 * beatPulse * sceneBright})`);
    pg.addColorStop(0.5, `rgba(255,220,180,${0.02 * beatPulse * sceneBright})`);
    pg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2); ctx.fill();
  }
}
