// ─── 6. PLASMA DUO — magnetic field / atomic particle dynamics ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

let _plasmaBlobs = null;

function initPlasmaBlobs(w, h) {
  const cx = w/2, cy = h/2;
  _plasmaBlobs = [
    { // Yang — warm
      x: cx - w * 0.1, y: cy,
      vx: 1.2, vy: 0.5,
      baseR: Math.min(w, h) * 0.65,
      hue: 275, sat: 55,
      noiseOff: 0, noiseScale: 1.5,
      phase: 0, mass: 2,
    },
    { // Yin — cool
      x: cx + w * 0.1, y: cy,
      vx: -1.2, vy: -0.4,
      baseR: Math.min(w, h) * 0.55,
      hue: 320, sat: 50,
      noiseOff: 50, noiseScale: 1.8,
      phase: Math.PI, mass: 1.7,
    },
  ];
}

export function resetPlasma() {
  _plasmaBlobs = null;
}

export function renderPlasmaNebula(ctx, w, h, t, bands) {
  if (!_plasmaBlobs) initPlasmaBlobs(w, h);
  const time = t * 0.001;
  const bass = bands.bass||0, sub = bands.subBass||0, mid = bands.mid||0;
  const highMid = bands.highMid||0, pres = bands.presence||0, brill = bands.brilliance||0, overall = bands.overall||0;
  const cx = w/2, cy = h/2;

  const A = _plasmaBlobs[0];
  const B = _plasmaBlobs[1];

  // ── Dynamic sizing — pulsing with audio ──
  const dynA = 1 + bass * 0.6 + sub * 0.4 + Math.sin(time * 0.2 + A.phase) * 0.12 + mid * 0.2;
  const dynB = 1 + bass * 0.5 + sub * 0.3 + Math.sin(time * 0.2 + B.phase) * 0.12 + highMid * 0.25;
  const rA = A.baseR * dynA;
  const rB = B.baseR * dynB;

  // ── Magnetic field physics ──
  const ddx = B.x - A.x, ddy = B.y - A.y;
  const dist = Math.sqrt(ddx*ddx + ddy*ddy) + 1;
  const ux = ddx/dist, uy = ddy/dist; // unit vector A→B

  // Magnetic-style force: strong attraction at medium range, repulsion when overlapping
  const equilibrium = (rA + rB) * 0.35;
  const gap = dist - equilibrium;
  const attract = gap * 0.0006 * (1 + overall * 0.5);
  const repel = gap < 0 ? gap * 0.002 : 0;
  const forceMag = attract + repel;

  // Perpendicular orbital force — creates electron-like orbiting
  const orbSpeed = 0.2 + mid * 0.4 + bass * 0.15;
  const orbFx = -uy * orbSpeed * 0.012;
  const orbFy = ux * orbSpeed * 0.012;

  // Bass impulse — sudden burst apart like particle collision
  const bassImpulse = bass > 0.45 ? (bass - 0.45) * 0.4 : 0;
  const impX = -ux * bassImpulse;
  const impY = -uy * bassImpulse;

  // Sub-bass creates slow breathing orbit expansion
  const breathOrbit = Math.sin(time * 0.15) * sub * 0.08;
  const breathFx = -ux * breathOrbit;
  const breathFy = -uy * breathOrbit;

  // Noise wandering
  const wAx = simplex.noise2D(0, time * 0.05) * 0.2;
  const wAy = simplex.noise2D(5, time * 0.05) * 0.15;
  const wBx = simplex.noise2D(50, time * 0.05) * 0.2;
  const wBy = simplex.noise2D(55, time * 0.05) * 0.15;

  // Apply forces
  A.vx += (ux * forceMag + orbFx + impX + breathFx + wAx * 0.015) * A.mass;
  A.vy += (uy * forceMag + orbFy + impY * 0.7 + breathFy + wAy * 0.015) * A.mass;
  B.vx += (-ux * forceMag - orbFx - impX - breathFx + wBx * 0.015) * B.mass;
  B.vy += (-uy * forceMag - orbFy - impY * 0.7 - breathFy + wBy * 0.015) * B.mass;

  // Center gravity — gentle pull to keep on screen
  [A, B].forEach(blob => {
    const cdx = blob.x - cx, cdy = blob.y - cy;
    const cdist = Math.sqrt(cdx*cdx + cdy*cdy) + 1;
    blob.vx -= cdx * 0.00015 * (cdist / (Math.min(w,h) * 0.3));
    blob.vy -= cdy * 0.00015 * (cdist / (Math.min(w,h) * 0.3));
    blob.vx *= 0.988;
    blob.vy *= 0.988;
    blob.x += blob.vx;
    blob.y += blob.vy;
  });

  // ── Magnetic field lines — visible force field ──
  const fieldLines = 16;
  for (let fi = 0; fi < fieldLines; fi++) {
    const startAngle = (fi / fieldLines) * Math.PI * 2;
    const startR = rA * 0.15;
    let px = A.x + Math.cos(startAngle) * startR;
    let py = A.y + Math.sin(startAngle) * startR;

    ctx.beginPath();
    ctx.moveTo(px, py);

    for (let step = 0; step < 60; step++) {
      const distA = Math.sqrt((px-A.x)*(px-A.x) + (py-A.y)*(py-A.y)) + 1;
      const distB = Math.sqrt((px-B.x)*(px-B.x) + (py-B.y)*(py-B.y)) + 1;

      const fAx = (px - A.x) / (distA * distA) * 5000;
      const fAy = (py - A.y) / (distA * distA) * 5000;
      const fBx = (B.x - px) / (distB * distB) * 5000;
      const fBy = (B.y - py) / (distB * distB) * 5000;

      const ffx = fAx + fBx, ffy = fAy + fBy;
      const fMag = Math.sqrt(ffx*ffx + ffy*ffy) + 0.001;
      const stepSize = 8;
      px += (ffx / fMag) * stepSize;
      py += (ffy / fMag) * stepSize;

      ctx.lineTo(px, py);

      if (distB < rB * 0.15 || px < -50 || px > w+50 || py < -50 || py > h+50) break;
    }

    const fieldAlpha = (0.008 + overall * 0.015 + pres * 0.01) * (0.5 + Math.sin(time * 0.5 + fi * 0.4) * 0.5);
    const fieldHue = 290 + fi * 4 + mid * 15;
    ctx.strokeStyle = hsl(fieldHue, 35, 50, fieldAlpha);
    ctx.lineWidth = 0.5 + overall * 1;
    ctx.stroke();
  }

  // ── Draw blobs ──
  const drawBlob = (blob, radius, isPrimary) => {
    const hue = blob.hue + mid * 25 + simplex.noise2D(blob.noiseOff, time * 0.1) * 15;
    const sat = blob.sat + pres * 15;

    const gcOffX = simplex.noise2D(blob.noiseOff + 20, time * 0.06) * radius * 0.25;
    const gcOffY = simplex.noise2D(blob.noiseOff + 30, time * 0.06) * radius * 0.2;
    const gcx = blob.x + gcOffX;
    const gcy = blob.y + gcOffY;

    for (let layer = 6; layer >= 0; layer--) {
      const layerT = layer / 6;
      const lr = radius * (0.2 + layerT * 0.95);
      const noiseAmp = 0.2 + layerT * 0.3 + bass * 0.15;
      const alpha = (0.012 + bass * 0.015 + overall * 0.01) * (1 - layerT * 0.55);
      const light = 25 + (1-layerT) * 25 + brill * 10;

      const grad = ctx.createRadialGradient(gcx, gcy, lr * 0.15, blob.x, blob.y, lr);
      grad.addColorStop(0, hsl(hue, sat+5, light+15, alpha*2));
      grad.addColorStop(0.2, hsl(hue+5, sat, light+8, alpha*1.5));
      grad.addColorStop(0.45, hsl(hue+10, sat-5, light, alpha));
      grad.addColorStop(0.7, hsl(hue+18, sat-12, light-8, alpha*0.5));
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;

      ctx.beginPath();
      const segs = 90;
      for (let s = 0; s <= segs; s++) {
        const a = (s/segs) * Math.PI * 2;
        const n1 = simplex.noise3D(Math.cos(a)*blob.noiseScale, Math.sin(a)*blob.noiseScale, time*0.08+layer*0.2+blob.noiseOff);
        const n2 = simplex.noise2D(Math.cos(a)*blob.noiseScale*2.5+blob.noiseOff, Math.sin(a)*blob.noiseScale*2.5+time*0.1);
        const n3 = simplex.noise2D(Math.cos(a)*blob.noiseScale*5+time*0.04, Math.sin(a)*blob.noiseScale*5+blob.noiseOff*0.3);
        const n4 = simplex.noise2D(Math.cos(a)*0.8+blob.noiseOff*0.1, Math.sin(a)*0.8+time*0.05) * 0.3;
        const other = isPrimary ? B : A;
        const toOther = Math.atan2(other.y - blob.y, other.x - blob.x);
        const angleDiff = Math.cos(a - toOther);
        const proximity = 1 - Math.min(1, dist / ((rA+rB) * 0.8));
        const stretch = angleDiff > 0 ? angleDiff * 0.3 * proximity : 0;

        const rr = lr * (1 + n1*noiseAmp + n2*noiseAmp*0.4 + n3*noiseAmp*0.12 + n4 + stretch);
        ctx.lineTo(blob.x + Math.cos(a)*rr, blob.y + Math.sin(a)*rr);
      }
      ctx.closePath();
      ctx.fill();
    }
  };

  // Depth sort
  if (A.y > B.y) { drawBlob(B, rB, false); drawBlob(A, rA, true); }
  else { drawBlob(A, rA, true); drawBlob(B, rB, false); }

  // ── Interaction zone — luminous merge at contact ──
  const overlap = (rA + rB) * 0.5 - dist;
  if (overlap > 0) {
    const blendT = Math.min(1, overlap / (Math.min(rA, rB) * 0.4));
    const mx = (A.x * rB + B.x * rA) / (rA + rB);
    const my = (A.y * rB + B.y * rA) / (rA + rB);
    const mergeR = Math.min(rA, rB) * 0.5 * blendT;
    const mergeHue = (A.hue + B.hue) / 2 + mid * 15;

    for (let ml = 4; ml >= 0; ml--) {
      const mlr = mergeR * (0.4 + ml * 0.45);
      const mla = blendT * (0.015 + bass * 0.025) * (1 - ml/5);
      const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mlr);
      mg.addColorStop(0, hsl(mergeHue, 75, 78, mla * 3));
      mg.addColorStop(0.2, hsl(mergeHue + 8, 65, 65, mla * 2));
      mg.addColorStop(0.5, hsl(mergeHue + 15, 55, 50, mla));
      mg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(mx, my, mlr, 0, Math.PI*2); ctx.fill();
    }

    // Energy bridge — plasma tendril
    const bridgeAlpha = blendT * (0.025 + mid * 0.04);
    for (let bi = 0; bi < 3; bi++) {
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      const off = (bi - 1) * 20;
      const cp1x = (A.x+mx)/2 + simplex.noise2D(time*0.3+bi, 0)*40 + off;
      const cp1y = (A.y+my)/2 + simplex.noise2D(0, time*0.3+bi)*35;
      const cp2x = (B.x+mx)/2 + simplex.noise2D(time*0.3+bi, 10)*40 - off;
      const cp2y = (B.y+my)/2 + simplex.noise2D(10, time*0.3+bi)*35;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, B.x, B.y);
      ctx.strokeStyle = hsl(mergeHue + bi*15, 50, 60, bridgeAlpha * (1 - bi*0.25));
      ctx.lineWidth = (2 + blendT * 6) * (1 - bi*0.3);
      ctx.shadowColor = hsl(mergeHue, 60, 55, bridgeAlpha * 0.5);
      ctx.shadowBlur = 12;
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  // Tiny scattered particles
  for (let i = 0; i < 40; i++) {
    const px = w * (simplex.noise2D(i*8.3, time*0.12)*0.5+0.5);
    const py = h * (simplex.noise2D(i*14.7, time*0.12+100)*0.5+0.5);
    const tw = 0.5 + Math.sin(time*1.2 + i*3.1)*0.5;
    ctx.fillStyle = hsl(280+i*2, 25, 75, (0.012+brill*0.08)*tw);
    ctx.beginPath(); ctx.arc(px, py, 0.4+brill, 0, Math.PI*2); ctx.fill();
  }
}
