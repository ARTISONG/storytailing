// ── LIQUID GLASS TITLE — frosted glass + background-sampled gradient border ──

export function renderSongTitle(ctx, w, h, title, title2, bands, t, pos, fontSizePct, fontSizePct2) {
  if (!title && !title2) return;

  const time    = t * 0.001;
  const bass    = bands?.bass        || 0;
  const overall = bands?.overall     || 0;
  const brill   = bands?.brilliance  || 0;
  const breathe = Math.sin(time * 0.18) * 4 + Math.sin(time * 0.09) * 1.5;

  ctx.save();
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  /* ── font metrics ── */
  const calcFs = (text, pct, wt) => {
    if (!text) return null;
    const targetW = w * (pct / 100);
    let fs = Math.round(w * 0.16);
    ctx.font = `${wt} ${fs}px "Cormorant Garamond","Sarabun",Georgia,serif`;
    let m = ctx.measureText(text).width;
    if (m > targetW && m > 0) fs = Math.round(fs * (targetW / m));
    fs = Math.max(18, Math.min(fs, h * 0.26));
    ctx.font = `${wt} ${fs}px "Cormorant Garamond","Sarabun",Georgia,serif`;
    m = ctx.measureText(text).width;
    return { fs, measured: m, textH: fs * 1.05 };
  };

  const line1 = calcFs(title,  fontSizePct,  300);
  const line2 = calcFs(title2, fontSizePct2, 200);
  const gap    = line1 && line2 ? Math.max(line1.fs, line2.fs) * 0.3 : 0;
  const totalH = (line1?.textH ?? 0) + gap + (line2?.textH ?? 0);
  const maxM   = Math.max(line1?.measured ?? 0, line2?.measured ?? 0);
  const refFs  = line1?.fs ?? line2?.fs ?? 40;

  /* ── pill geometry ── */
  const padX  = refFs * 1.25;
  const padY  = refFs * 0.68;
  const pillW = maxM   + padX * 2;
  const pillH = totalH + padY * 2;
  const pillR = pillH  * 0.44;

  /* ── anchor ── */
  const margin = Math.max(refFs * 0.7, 44);
  const posMap = {
    "top-left":      { cx: margin + pillW / 2,    cy: margin + pillH / 2 },
    "top-center":    { cx: w / 2,                  cy: margin + pillH / 2 },
    "top-right":     { cx: w - margin - pillW / 2, cy: margin + pillH / 2 },
    "middle-left":   { cx: margin + pillW / 2,    cy: h / 2 },
    "middle-center": { cx: w / 2,                  cy: h / 2 },
    "middle-right":  { cx: w - margin - pillW / 2, cy: h / 2 },
    "bottom-left":   { cx: margin + pillW / 2,    cy: h - margin - pillH / 2 },
    "bottom-center": { cx: w / 2,                  cy: h - margin - pillH / 2 },
    "bottom-right":  { cx: w - margin - pillW / 2, cy: h - margin - pillH / 2 },
  };
  const { cx, cy: anchorCY } = posMap[pos] || posMap["bottom-center"];
  const cy = anchorCY + breathe;

  const pillX = cx - pillW / 2;
  const pillY = cy - pillH / 2;

  const y1 = line1 && line2 ? cy - totalH / 2 + line1.textH / 2 : cy;
  const y2 = line1 && line2 ? cy + totalH / 2 - line2.textH / 2 : cy;

  /* ══════════════════════════════════════════════════════════
     STEP 1 — sample background colors at pill perimeter
     for the gradient border that "glows" with bg hue
     ══════════════════════════════════════════════════════════ */
  const sampleColor = (sx, sy) => {
    try {
      const px = Math.max(0, Math.min(w - 1, Math.round(sx)));
      const py = Math.max(0, Math.min(h - 1, Math.round(sy)));
      const d  = ctx.getImageData(px, py, 1, 1).data;
      return [d[0], d[1], d[2]];
    } catch { return [200, 200, 200]; }
  };

  // sample at top / right / bottom / left midpoints (outside pill slightly)
  const off4 = 12;
  const [rt, gt, bt] = sampleColor(cx,            pillY - off4);     // top
  const [rr, gr, br] = sampleColor(pillX + pillW + off4, cy);        // right
  const [rb, gb, bb] = sampleColor(cx,            pillY + pillH + off4); // bottom
  const [rl, gl, bl] = sampleColor(pillX - off4,  cy);               // left

  /* lighten & saturate the sampled color for a "glowing rim" effect */
  const rimColor = ([r, g, b], alpha) => {
    const mx  = Math.max(r, g, b);
    const lf  = mx > 0 ? Math.min(255 / mx, 2.2) : 1; // boost towards white
    const nr  = Math.min(255, r * lf * 1.15 + 80);
    const ng  = Math.min(255, g * lf * 1.15 + 80);
    const nb  = Math.min(255, b * lf * 1.15 + 80);
    return `rgba(${Math.round(nr)},${Math.round(ng)},${Math.round(nb)},${alpha})`;
  };

  /* ══════════════════════════════════════════════════════════
     STEP 2 — frosted glass: blur pixels behind the pill
     ══════════════════════════════════════════════════════════ */
  const blurR  = Math.round(refFs * 0.6);
  const expand = blurR * 2;
  const sX = Math.max(0, Math.floor(pillX - expand));
  const sY = Math.max(0, Math.floor(pillY - expand));
  const sW = Math.min(w - sX, Math.ceil(pillW + expand * 2));
  const sH = Math.min(h - sY, Math.ceil(pillH + expand * 2));

  try {
    const snap   = ctx.getImageData(sX, sY, sW, sH);
    const off    = new OffscreenCanvas(sW, sH);
    const offCtx = off.getContext("2d");
    offCtx.putImageData(snap, 0, 0);
    offCtx.filter = `blur(${blurR}px)`;
    offCtx.drawImage(off, 0, 0);
    offCtx.filter = "none";

    ctx.save();
    roundRect(ctx, pillX, pillY, pillW, pillH, pillR);
    ctx.clip();
    ctx.drawImage(off, sX, sY, sW, sH);
    ctx.restore();
  } catch (_) { /* fallback: just skip blur */ }

  /* ══════════════════════════════════════════════════════════
     STEP 3 — tint: very subtle white + warm overlay
     ══════════════════════════════════════════════════════════ */
  ctx.save();
  roundRect(ctx, pillX, pillY, pillW, pillH, pillR);
  ctx.clip();

  // base white tint (thin)
  ctx.fillStyle = `rgba(255,255,255,${0.10 + brill * 0.04})`;
  ctx.fillRect(pillX, pillY, pillW, pillH);

  // vertical gradient: lighter top, slightly dimmer bottom
  const tg = ctx.createLinearGradient(0, pillY, 0, pillY + pillH);
  tg.addColorStop(0,    `rgba(255,255,255,${0.16 + brill * 0.05})`);
  tg.addColorStop(0.5,  "rgba(255,255,255,0.03)");
  tg.addColorStop(1,    "rgba(0,0,0,0.05)");
  ctx.fillStyle = tg;
  ctx.fillRect(pillX, pillY, pillW, pillH);

  ctx.restore();

  /* ══════════════════════════════════════════════════════════
     STEP 4 — outer drop shadow
     ══════════════════════════════════════════════════════════ */
  ctx.save();
  ctx.shadowColor   = `rgba(0,0,0,${0.26 + bass * 0.08})`;
  ctx.shadowBlur    = refFs * 1.6;
  ctx.shadowOffsetY = refFs * 0.12;
  ctx.shadowOffsetX = 0;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillR);
  ctx.fillStyle = "rgba(0,0,0,0.01)";
  ctx.fill();
  ctx.shadowBlur    = refFs * 0.3;
  ctx.shadowOffsetY = refFs * 0.05;
  ctx.shadowColor   = `rgba(0,0,0,${0.32 + bass * 0.1})`;
  ctx.fill();
  ctx.restore();

  /* ══════════════════════════════════════════════════════════
     STEP 5 — background-sampled gradient border
     Uses conic-like approach: 4 linear gradients on each side
     ══════════════════════════════════════════════════════════ */
  const borderA = 0.55 + brill * 0.18 + bass * 0.08;
  const borderW = 1.5;

  // outer glow ring (wide, sampled hue)
  ctx.save();
  ctx.shadowBlur  = refFs * 0.5;
  ctx.shadowColor = `rgba(${Math.round((rt+rb)/2)},${Math.round((gt+gb)/2)},${Math.round((bt+bb)/2)},${0.35 + brill * 0.2})`;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillR);
  ctx.strokeStyle = "rgba(255,255,255,0.01)";
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.restore();

  // gradient border: top arc (top color → right color)
  ctx.save();
  const gTop = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY);
  gTop.addColorStop(0,   rimColor([rl, gl, bl], borderA));
  gTop.addColorStop(0.5, rimColor([rt, gt, bt], borderA * 1.1));
  gTop.addColorStop(1,   rimColor([rr, gr, br], borderA));

  const gBot = ctx.createLinearGradient(pillX, pillY + pillH, pillX + pillW, pillY + pillH);
  gBot.addColorStop(0,   rimColor([rl, gl, bl], borderA * 0.6));
  gBot.addColorStop(0.5, rimColor([rb, gb, bb], borderA * 0.7));
  gBot.addColorStop(1,   rimColor([rr, gr, br], borderA * 0.6));

  // draw border as two halves (top brighter, bottom dimmer — Apple glass look)
  const borderPath = new Path2D();
  const r = Math.min(pillR, pillW / 2, pillH / 2);
  borderPath.moveTo(pillX + r, pillY);
  borderPath.arcTo(pillX + pillW, pillY,     pillX + pillW, pillY + pillH, r);
  borderPath.arcTo(pillX + pillW, pillY + pillH, pillX,     pillY + pillH, r);
  borderPath.arcTo(pillX,         pillY + pillH, pillX,     pillY,         r);
  borderPath.arcTo(pillX,         pillY,         pillX + pillW, pillY,     r);
  borderPath.closePath();

  ctx.lineWidth = borderW;
  // top half border
  ctx.strokeStyle = gTop;
  ctx.stroke(borderPath);
  ctx.restore();

  ctx.save();
  ctx.lineWidth   = borderW * 0.7;
  const gBot2 = ctx.createLinearGradient(pillX, pillY + pillH * 0.5, pillX + pillW, pillY + pillH);
  gBot2.addColorStop(0,   rimColor([rl, gl, bl], borderA * 0.5));
  gBot2.addColorStop(0.5, rimColor([rb, gb, bb], borderA * 0.65));
  gBot2.addColorStop(1,   rimColor([rr, gr, br], borderA * 0.5));
  ctx.strokeStyle = gBot2;
  ctx.stroke(borderPath);
  ctx.restore();

  /* inner top specular rim (classic Apple liquid glass) */
  ctx.save();
  roundRect(ctx, pillX + 1, pillY + 1, pillW - 2, pillH * 0.4, pillR);
  ctx.clip();
  const specG = ctx.createLinearGradient(0, pillY, 0, pillY + pillH * 0.4);
  specG.addColorStop(0,   `rgba(255,255,255,${0.28 + brill * 0.1})`);
  specG.addColorStop(0.7, "rgba(255,255,255,0.04)");
  specG.addColorStop(1,   "rgba(255,255,255,0)");
  ctx.fillStyle = specG;
  ctx.fillRect(pillX, pillY, pillW, pillH * 0.4);
  ctx.restore();

  /* ══════════════════════════════════════════════════════════
     STEP 6 — gold ornament divider
     ══════════════════════════════════════════════════════════ */
  if (line1 && line2) {
    const divY = cy - totalH / 2 + line1.textH + gap / 2;
    const divW = Math.min(maxM * 0.48, refFs * 3.0);
    const divA = 0.45 + brill * 0.2;
    const ds   = Math.max(3, refFs * 0.07);

    ctx.save();
    ctx.shadowColor = `rgba(255,210,80,${0.45 + brill * 0.25})`;
    ctx.shadowBlur  = ds * 3;
    [[cx - divW / 2, cx - refFs * 0.24], [cx + refFs * 0.24, cx + divW / 2]].forEach(([xs, xe]) => {
      const g = ctx.createLinearGradient(xs, 0, xe, 0);
      const left = xe < cx;
      g.addColorStop(left ? 0 : 1, "rgba(212,175,55,0)");
      g.addColorStop(left ? 1 : 0, `rgba(245,215,90,${divA})`);
      ctx.beginPath(); ctx.moveTo(xs, divY); ctx.lineTo(xe, divY);
      ctx.strokeStyle = g; ctx.lineWidth = 0.9; ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(cx, divY - ds); ctx.lineTo(cx + ds * 1.2, divY);
    ctx.lineTo(cx, divY + ds); ctx.lineTo(cx - ds * 1.2, divY);
    ctx.closePath();
    ctx.fillStyle = `rgba(252,228,120,${divA * 1.1})`;
    ctx.fill();
    ctx.restore();
  }

  /* ══════════════════════════════════════════════════════════
     STEP 7 — frosted text
     Text itself is drawn blurred first (the "frost" of the letters),
     then a clean sharp version is composited on top at lower opacity
     creating a "etched in glass" look
     ══════════════════════════════════════════════════════════ */
  const drawLine = (text, info, ty, isSecond) => {
    if (!text || !info) return;
    const { fs, measured } = info;
    const wt = isSecond ? 200 : 300;
    ctx.font = `${wt} ${fs}px "Cormorant Garamond","Sarabun",Georgia,serif`;

    /* etch 1 — wide frosted halo (the "blur" of the glass text) */
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.shadowBlur    = fs * 0.45;
    ctx.shadowColor   = `rgba(255,255,255,${isSecond ? 0.55 : 0.75})`;
    ctx.fillStyle     = `rgba(255,255,255,${isSecond ? 0.35 : 0.55})`;
    ctx.fillText(text, cx, ty);

    /* etch 2 — tighter glow, warm white */
    ctx.shadowBlur  = fs * 0.15;
    ctx.shadowColor = `rgba(255,248,220,${isSecond ? 0.4 : 0.6})`;
    ctx.fillStyle   = `rgba(255,252,240,${isSecond ? 0.5 : 0.75})`;
    ctx.fillText(text, cx, ty);
    ctx.shadowBlur = 0; ctx.shadowColor = "rgba(0,0,0,0)";

    /* etch 3 — sharp clean white on top (the "clear" part of etched glass) */
    ctx.fillStyle = `rgba(255,255,255,${isSecond ? 0.65 : 0.88})`;
    ctx.fillText(text, cx, ty);

    /* etch 4 — top-lit vertical highlight */
    const vg = ctx.createLinearGradient(0, ty - info.textH * 0.5, 0, ty + info.textH * 0.2);
    vg.addColorStop(0,   `rgba(255,255,255,${isSecond ? 0.3 : 0.45})`);
    vg.addColorStop(0.4, `rgba(255,255,255,${isSecond ? 0.08 : 0.15})`);
    vg.addColorStop(1,   "rgba(255,255,255,0)");
    ctx.fillStyle = vg;
    ctx.fillText(text, cx, ty);

    /* etch 5 — bass beat brightens text */
    if (bass > 0.35 && !isSecond) {
      ctx.shadowBlur  = fs * 0.35;
      ctx.shadowColor = `rgba(255,255,255,${(bass - 0.35) * 0.6})`;
      ctx.fillStyle   = `rgba(255,255,255,${(bass - 0.35) * 0.4})`;
      ctx.fillText(text, cx, ty);
      ctx.shadowBlur  = 0; ctx.shadowColor = "rgba(0,0,0,0)";
    }
  };

  if (line1) drawLine(title,  line1, line2 ? y1 : cy, false);
  if (line2) drawLine(title2, line2, line1 ? y2 : cy, true);

  ctx.restore();
}

/* ── roundRect helper ── */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h,     x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y,         x + rr, y);
  ctx.closePath();
}
