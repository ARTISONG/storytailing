// ── FROSTED GLASS TEXT — blur clipped to letter shapes, no box ──

export function renderSongTitle(ctx, w, h, title, title2, bands, t, pos, fontSizePct, fontSizePct2) {
  if (!title && !title2) return;

  const time    = t * 0.001;
  const bass    = bands?.bass       || 0;
  const overall = bands?.overall    || 0;
  const brill   = bands?.brilliance || 0;
  const breathe = Math.sin(time * 0.18) * 4 + Math.sin(time * 0.09) * 1.5;

  ctx.save();
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";

  /* ── measure ── */
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
    return { fs, measured: m, textH: fs * 1.1 };
  };

  const line1 = calcFs(title,  fontSizePct,  500);
  const line2 = calcFs(title2, fontSizePct2, 300);
  const gap    = line1 && line2 ? Math.max(line1.fs, line2.fs) * 0.35 : 0;
  const totalH = (line1?.textH ?? 0) + gap + (line2?.textH ?? 0);
  const maxM   = Math.max(line1?.measured ?? 0, line2?.measured ?? 0);
  const refFs  = line1?.fs ?? line2?.fs ?? 40;

  /* ── anchor ── */
  const pad = Math.max(refFs * 0.8, 50);
  const posMap = {
    "top-left":      { cx: pad + maxM / 2,    cy: pad + totalH / 2 },
    "top-center":    { cx: w / 2,              cy: pad + totalH / 2 },
    "top-right":     { cx: w - pad - maxM / 2, cy: pad + totalH / 2 },
    "middle-left":   { cx: pad + maxM / 2,    cy: h / 2 },
    "middle-center": { cx: w / 2,              cy: h / 2 },
    "middle-right":  { cx: w - pad - maxM / 2, cy: h / 2 },
    "bottom-left":   { cx: pad + maxM / 2,    cy: h - pad - totalH / 2 },
    "bottom-center": { cx: w / 2,              cy: h - pad - totalH / 2 },
    "bottom-right":  { cx: w - pad - maxM / 2, cy: h - pad - totalH / 2 },
  };
  const anc = posMap[pos] || posMap["bottom-center"];
  const cx  = anc.cx;
  const cy  = anc.cy + breathe;
  const y1  = line1 && line2 ? cy - totalH / 2 + line1.textH / 2 : cy;
  const y2  = line1 && line2 ? cy + totalH / 2 - line2.textH / 2 : cy;

  /* ══════════════════════════════════════════════════
     DRAW ONE LINE — frosted glass clipped to letters
     ══════════════════════════════════════════════════ */
  const drawFrostedLine = (text, info, ty, isSecond) => {
    if (!text || !info) return;
    const { fs, measured } = info;
    const wt = isSecond ? 300 : 500;
    const font = `${wt} ${fs}px "Cormorant Garamond","Sarabun",Georgia,serif`;
    const blurR = Math.round(fs * 0.55 + bass * fs * 0.1);

    // bounding box for this line (with margin for blur overflow)
    const margin = blurR * 2.5;
    const bx = cx - measured / 2 - margin;
    const by = ty  - fs * 0.7    - margin;
    const bw = measured + margin * 2;
    const bh = fs * 1.4 + margin * 2;
    const sx = Math.max(0, bx | 0);
    const sy = Math.max(0, by | 0);
    const sw = Math.min(w - sx, (bw + 1) | 0);
    const sh = Math.min(h - sy, (bh + 1) | 0);

    /* ── step A: grab & blur background pixels ── */
    let blurredBg = null;
    try {
      const snap    = ctx.getImageData(sx, sy, sw, sh);
      const offBg   = new OffscreenCanvas(sw, sh);
      const offBgCtx = offBg.getContext("2d");
      offBgCtx.putImageData(snap, 0, 0);
      offBgCtx.filter = `blur(${blurR}px)`;
      offBgCtx.drawImage(offBg, 0, 0);
      offBgCtx.filter = "none";
      blurredBg = offBg;
    } catch (_) {}

    /* ── step B: composite blurred bg masked to text shape ── */
    if (blurredBg) {
      try {
        const offMask    = new OffscreenCanvas(w, h);
        const offMaskCtx = offMask.getContext("2d");
        offMaskCtx.textAlign    = "center";
        offMaskCtx.textBaseline = "middle";
        offMaskCtx.font         = font;

        // draw blurred bg (offset-corrected)
        offMaskCtx.drawImage(blurredBg, sx, sy, sw, sh);

        // punch through only where text is: destination-in keeps only overlap
        offMaskCtx.globalCompositeOperation = "destination-in";
        offMaskCtx.fillStyle = "rgba(255,255,255,1)";
        offMaskCtx.fillText(text, cx, ty);

        // composite frosted text onto main canvas
        ctx.drawImage(offMask, 0, 0);
      } catch (_) {}
    }

    /* ── step C: sample bg edge colors for rim gradient ── */
    const sc = (sx2, sy2) => {
      try {
        const d = ctx.getImageData(
          Math.max(0, Math.min(w - 1, sx2 | 0)),
          Math.max(0, Math.min(h - 1, sy2 | 0)), 1, 1
        ).data;
        return [d[0], d[1], d[2]];
      } catch { return [180, 180, 180]; }
    };
    const rim = ([r, g, b], a) => {
      const mx = Math.max(r, g, b);
      const s  = mx > 10 ? Math.min(2.6, 210 / mx) : 1;
      return `rgba(${Math.min(255,(r*s+70))|0},${Math.min(255,(g*s+70))|0},${Math.min(255,(b*s+70))|0},${a})`;
    };
    const cT = sc(cx,               ty - fs * 0.55);
    const cB = sc(cx,               ty + fs * 0.55);
    const cL = sc(cx - measured / 2, ty);
    const cR = sc(cx + measured / 2, ty);

    ctx.font = font;

    /* ── step D: outer glow halo (bg hue) ── */
    const avgC = [
      (cT[0]+cB[0]+cL[0]+cR[0])>>2,
      (cT[1]+cB[1]+cL[1]+cR[1])>>2,
      (cT[2]+cB[2]+cL[2]+cR[2])>>2,
    ];
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.shadowBlur    = fs * 0.9 + overall * fs * 0.3;
    ctx.shadowColor   = `rgba(${avgC[0]},${avgC[1]},${avgC[2]},${0.45 + brill * 0.2 + bass * 0.1})`;
    ctx.fillStyle     = "rgba(255,255,255,0.01)";
    ctx.fillText(text, cx, ty);

    /* ── step E: white frost overlay — thin, lets blur show through ── */
    ctx.shadowBlur  = fs * 0.35;
    ctx.shadowColor = `rgba(255,255,255,${0.5 + brill * 0.15})`;
    ctx.fillStyle   = `rgba(255,255,255,${isSecond ? 0.12 : 0.18})`;
    ctx.fillText(text, cx, ty);
    ctx.shadowBlur = 0; ctx.shadowColor = "rgba(0,0,0,0)";

    /* ── step F: bg-sampled gradient rim stroke (bright, for definition) ── */
    const strokeG = ctx.createLinearGradient(
      cx - measured / 2, ty - fs * 0.5,
      cx + measured / 2, ty + fs * 0.5
    );
    const sa = 0.75 + brill * 0.2 + bass * 0.1;
    strokeG.addColorStop(0,    rim(cL, sa * 0.8));
    strokeG.addColorStop(0.25, rim(cT, sa));
    strokeG.addColorStop(0.5,  rim(cR, sa * 0.9));
    strokeG.addColorStop(0.75, rim(cB, sa * 0.7));
    strokeG.addColorStop(1,    rim(cL, sa * 0.6));
    ctx.lineWidth   = Math.max(1.2, fs * 0.028);
    ctx.lineJoin    = "round";
    ctx.strokeStyle = strokeG;
    ctx.strokeText(text, cx, ty);

    /* ── step G: white inner stroke hairline (crisp edge) ── */
    ctx.lineWidth   = Math.max(0.5, fs * 0.01);
    ctx.strokeStyle = `rgba(255,255,255,${isSecond ? 0.45 : 0.65})`;
    ctx.strokeText(text, cx, ty);

    /* ── step H: top-lit specular — subtle, on top of glass ── */
    const vg = ctx.createLinearGradient(0, ty - fs * 0.52, 0, ty);
    vg.addColorStop(0, `rgba(255,255,255,${isSecond ? 0.35 : 0.52})`);
    vg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = vg;
    ctx.fillText(text, cx, ty);

    /* ── step I: bass beat flare ── */
    if (bass > 0.38) {
      ctx.shadowBlur  = fs * 0.5;
      ctx.shadowColor = `rgba(255,255,255,${(bass - 0.38) * 0.8})`;
      ctx.fillStyle   = `rgba(255,255,255,${(bass - 0.38) * 0.3})`;
      ctx.fillText(text, cx, ty);
      ctx.shadowBlur  = 0; ctx.shadowColor = "rgba(0,0,0,0)";
    }
  };

  /* ══════════════════════════════════
     GOLD ORNAMENT DIVIDER
     ══════════════════════════════════ */
  if (line1 && line2) {
    const dY = (y1 + y2) / 2;
    const dW = Math.min(maxM * 0.48, refFs * 3.0);
    const dA = 0.5 + brill * 0.2;
    const ds = Math.max(3, refFs * 0.07);

    ctx.save();
    ctx.shadowColor = `rgba(255,240,160,${0.5 + brill * 0.25})`;
    ctx.shadowBlur  = ds * 3;
    [[cx - dW / 2, cx - refFs * 0.24], [cx + refFs * 0.24, cx + dW / 2]].forEach(([xs, xe]) => {
      const g = ctx.createLinearGradient(xs, 0, xe, 0);
      const lft = xe < cx;
      g.addColorStop(lft ? 0 : 1, "rgba(255,235,140,0)");
      g.addColorStop(lft ? 1 : 0, `rgba(255,235,140,${dA})`);
      ctx.beginPath(); ctx.moveTo(xs, dY); ctx.lineTo(xe, dY);
      ctx.strokeStyle = g; ctx.lineWidth = 0.9; ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(cx, dY - ds); ctx.lineTo(cx + ds * 1.2, dY);
    ctx.lineTo(cx, dY + ds); ctx.lineTo(cx - ds * 1.2, dY);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,240,155,${dA * 1.1})`; ctx.fill();
    ctx.restore();
  }

  if (line1) drawFrostedLine(title,  line1, line2 ? y1 : cy, false);
  if (line2) drawFrostedLine(title2, line2, line1 ? y2 : cy, true);

  ctx.restore();
}
