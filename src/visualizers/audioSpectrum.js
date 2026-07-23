// ─── AUDIO EQUALIZER SPECTRUM — bottom-of-frame, multiple styles ─────────────
//   Styles: bars · mirror · wave · dots · line
//   Colour: "gradient" (one hue, auto dark→light fade) or "colorful" (rainbow)
//   Designed to read as dimensional & tasteful on any background: shared
//   gradients (cheap), rounded caps, soft non-shadow glow, glossy reflection.

const TAU = Math.PI * 2;

let _config = { style: "bars", colorMode: "gradient", color: "#3fa9ff", height: 0.20, opacity: 1.0 };

const BAR_COUNT = 56;
let _bars  = null;   // smoothed magnitudes 0..1
let _peaks = null;   // peak-hold caps 0..1

export function setSpectrumConfig(cfg) { Object.assign(_config, cfg); }
export function getSpectrumConfig()     { return { ..._config }; }
export function resetAudioSpectrum()    { _bars = null; _peaks = null; }

/* ── colour helpers ──────────────────────────────────────────────────────── */
function hexToHsl(hex) {
  hex = (hex || "#3fa9ff").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16) / 255,
        g = parseInt(hex.slice(2, 4), 16) / 255,
        b = parseInt(hex.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}
const hsla = (h, s, l, a) => `hsla(${h},${s}%,${l}%,${a})`;
// rainbow hue at fraction f (0..1) across the spectrum — cool→warm sweep
const rainbowHue = (f, drift) => (200 + f * 300 + drift) % 360;

/* ── FFT → smoothed bar magnitudes (log-frequency) ───────────────────────── */
function computeBars(freq) {
  if (!_bars) { _bars = new Float32Array(BAR_COUNT); _peaks = new Float32Array(BAR_COUNT); }
  const n = freq.length;                       // 512 bins
  const minBin = 1, maxBin = Math.floor(n * 0.72);
  const ratio = maxBin / minBin;
  for (let i = 0; i < BAR_COUNT; i++) {
    const f0 = Math.floor(minBin * Math.pow(ratio, i / BAR_COUNT));
    const f1 = Math.max(f0 + 1, Math.floor(minBin * Math.pow(ratio, (i + 1) / BAR_COUNT)));
    let sum = 0, c = 0;
    for (let b = f0; b < f1 && b < n; b++) { sum += freq[b]; c++; }
    let mag = c ? (sum / c) / 255 : 0;
    mag *= 0.55 + 1.1 * (i / BAR_COUNT);        // lift highs (naturally quieter)
    mag = Math.min(1, Math.pow(mag, 0.82));     // gentle gamma
    const cur = _bars[i];
    _bars[i] = mag > cur ? cur + (mag - cur) * 0.5    // fast attack
                         : cur + (mag - cur) * 0.14;  // slow, elegant release
    if (_bars[i] >= _peaks[i]) _peaks[i] = _bars[i];
    else _peaks[i] = Math.max(_bars[i], _peaks[i] - 0.012);
  }
}

/* rounded-top rectangle path */
function roundTopRect(ctx, x, y, wd, ht, r) {
  r = Math.min(r, wd / 2, ht);
  ctx.beginPath();
  ctx.moveTo(x, y + ht);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + wd - r, y);
  ctx.quadraticCurveTo(x + wd, y, x + wd, y + r);
  ctx.lineTo(x + wd, y + ht);
  ctx.closePath();
}

/* ── main render ─────────────────────────────────────────────────────────── */
export function renderAudioSpectrum(ctx, w, h, t, bands) {
  const freq = bands && bands.frequency;
  const wave = bands && bands.waveform;
  if (!freq && !wave) return;
  if (freq) computeBars(freq);
  if (!_bars) return;

  const time     = t * 0.001;
  const op       = _config.opacity;
  const style    = _config.style;
  const colorful = _config.colorMode === "colorful";
  const [bh, bs] = hexToHsl(_config.color);
  const drift    = time * 8;

  const areaH   = h * _config.height;
  const baseY   = h - h * 0.045;               // baseline near the bottom edge
  const marginX = w * 0.06;
  const areaW   = w - marginX * 2;
  const scale   = w / 1280;                    // size unit that tracks resolution

  // shared fills — one allocation per frame, not per bar
  const vGrad = (a = 1) => {                    // vertical: dark base → light tip
    const g = ctx.createLinearGradient(0, baseY, 0, baseY - areaH);
    g.addColorStop(0,   hsla(bh, bs, 24, op * a));
    g.addColorStop(0.5, hsla(bh, bs, 46, op * a));
    g.addColorStop(1,   hsla(bh, Math.min(100, bs + 6), 70, op * a));
    return g;
  };
  const hGrad = (a = 1) => {                    // horizontal rainbow
    const g = ctx.createLinearGradient(marginX, 0, marginX + areaW, 0);
    for (let k = 0; k <= 6; k++) g.addColorStop(k / 6, hsla(rainbowHue(k / 6, drift), 88, 58, op * a));
    return g;
  };

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap  = "round";
  const step = areaW / BAR_COUNT;

  if (style === "bars" || style === "mirror") {
    const gap   = step * 0.30;
    const barW  = step - gap;
    const r     = Math.min(barW * 0.5, 6 * scale);
    const fill  = colorful ? hGrad() : vGrad();
    const mirror = style === "mirror";
    const centerY = mirror ? baseY - areaH * 0.5 : baseY;

    // reflection (glossy floor) — only for upright bars
    if (!mirror) {
      ctx.save();
      ctx.globalAlpha = op * 0.16;
      ctx.translate(0, baseY * 2 + 6 * scale);
      ctx.scale(1, -1);
      ctx.fillStyle = fill;
      for (let i = 0; i < BAR_COUNT; i++) {
        const barH = Math.max(2, _bars[i] * areaH) * 0.55;
        roundTopRect(ctx, marginX + i * step + gap / 2, baseY - barH, barW, barH, r);
        ctx.fill();
      }
      ctx.restore();
    }

    // at tiny heights the fixed minimums would flatten the motion — scale them down
    const minBar  = Math.min(2 * scale, areaH * 0.10);
    const capMax  = Math.min(r * 2 + 2 * scale, areaH * 0.30);
    const peakTh  = Math.min(2 * scale, areaH * 0.12);

    for (let i = 0; i < BAR_COUNT; i++) {
      const x    = marginX + i * step + gap / 2;
      const barH = Math.max(minBar, _bars[i] * areaH * (mirror ? 0.5 : 1));

      ctx.fillStyle = fill;
      if (mirror) {
        roundTopRect(ctx, x, centerY - barH, barW, barH, r);        ctx.fill();
        roundTopRect(ctx, x, centerY + barH, barW, barH, r);         // lower half
        ctx.save(); ctx.translate(0, centerY * 2); ctx.scale(1, -1);
        roundTopRect(ctx, x, centerY - barH, barW, barH, r); ctx.fill(); ctx.restore();
      } else {
        roundTopRect(ctx, x, baseY - barH, barW, barH, r); ctx.fill();
      }

      // bright tip cap → dimensional gloss
      const capHue = colorful ? rainbowHue(i / BAR_COUNT, drift) : bh;
      ctx.fillStyle = hsla(capHue, colorful ? 90 : bs, 84, op * 0.95);
      const capH = Math.min(barH * 0.5, capMax);
      roundTopRect(ctx, x, (mirror ? centerY - barH : baseY - barH), barW, capH, r); ctx.fill();
      if (mirror) { roundTopRect(ctx, x, centerY + barH - capH, barW, capH, r); ctx.fill(); }

      // peak-hold cap (upright only)
      if (!mirror && _peaks[i] > 0.03) {
        const py = baseY - _peaks[i] * areaH;
        ctx.fillStyle = hsla(capHue, colorful ? 90 : bs, 90, op * 0.8);
        ctx.fillRect(x, py - peakTh, barW, peakTh);
      }
    }

  } else if (style === "dots") {
    const rows  = 18;
    const cellH = areaH / rows;
    const dotR  = Math.min(step, cellH) * 0.30;
    for (let i = 0; i < BAR_COUNT; i++) {
      const lit = Math.round(_bars[i] * rows);
      const cx  = marginX + (i + 0.5) * step;
      for (let rIdx = 0; rIdx < lit; rIdx++) {
        const yFrac = rIdx / rows;
        const cy = baseY - (rIdx + 0.5) * cellH;
        ctx.fillStyle = colorful
          ? hsla(rainbowHue(i / BAR_COUNT, drift), 88, 42 + yFrac * 40, op)
          : hsla(bh, bs, 26 + yFrac * 48, op);
        ctx.beginPath(); ctx.arc(cx, cy, dotR, 0, TAU); ctx.fill();
      }
    }

  } else if (style === "wave") {
    // smooth filled area through bar tops + bright crest line (layered for depth)
    const pts = [];
    for (let i = 0; i < BAR_COUNT; i++)
      pts.push([marginX + (i + 0.5) * step, baseY - _bars[i] * areaH]);

    const tracePath = (yShift, closeToBase) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1] + yShift);
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        ctx.quadraticCurveTo(x0, y0 + yShift, (x0 + x1) / 2, (y0 + y1) / 2 + yShift);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last[0], last[1] + yShift);
      if (closeToBase) { ctx.lineTo(marginX + areaW, baseY); ctx.lineTo(marginX, baseY); ctx.closePath(); }
    };

    // filled body
    tracePath(0, true);
    ctx.fillStyle = colorful ? hGrad(0.45) : vGrad(0.45);
    ctx.fill();
    // soft echo layer beneath (depth)
    tracePath(areaH * 0.12, false);
    ctx.lineWidth = 2.2 * scale;
    ctx.strokeStyle = colorful ? hGrad(0.35) : hsla(bh, bs, 55, op * 0.35);
    ctx.stroke();
    // bright crest
    tracePath(0, false);
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = colorful ? hGrad() : hsla(bh, Math.min(100, bs + 6), 72, op);
    ctx.stroke();

  } else if (style === "line") {
    // oscilloscope from the time-domain waveform
    const src = wave || _bars;
    const cY  = baseY - areaH * 0.5;
    const N   = wave ? wave.length : BAR_COUNT;
    const sx  = areaW / (N - 1);
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const v = wave ? (wave[i] - 128) / 128 : (_bars[i] * 2 - 1);
        const x = marginX + i * sx;
        const y = cY - v * areaH * 0.5;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
    };
    // glow underlay (wide + faint) — dimension without costly shadowBlur
    path(); ctx.lineWidth = 7 * scale;
    ctx.strokeStyle = colorful ? hGrad(0.25) : hsla(bh, bs, 55, op * 0.22); ctx.stroke();
    // crisp line
    path(); ctx.lineWidth = 2.4 * scale;
    ctx.strokeStyle = colorful ? hGrad() : hsla(bh, Math.min(100, bs + 6), 66, op); ctx.stroke();
  }

  ctx.restore();
}
