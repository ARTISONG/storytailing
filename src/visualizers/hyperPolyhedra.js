// ─── 3. HYPER POLYHEDRA — 3D rotating wireframes ───
import { simplex } from "../utils/simplex.js";
import { hsl } from "../utils/audio.js";

let _polyhedra = null;

function initPolyhedra() {
  // Icosahedron vertices
  const phi = (1 + Math.sqrt(5)) / 2;
  const icoVerts = [
    [-1, phi, 0],[1, phi, 0],[-1,-phi, 0],[1,-phi, 0],
    [0,-1, phi],[0, 1, phi],[0,-1,-phi],[0, 1,-phi],
    [phi, 0,-1],[phi, 0, 1],[-phi, 0,-1],[-phi, 0, 1],
  ].map(v => { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return v.map(c => c/l * 200); });
  const icoEdges = [
    [0,1],[0,5],[0,7],[0,10],[0,11],[1,5],[1,7],[1,8],[1,9],
    [2,3],[2,4],[2,6],[2,10],[2,11],[3,4],[3,6],[3,8],[3,9],
    [4,5],[4,9],[4,11],[5,9],[5,11],[6,7],[6,8],[6,10],
    [7,8],[7,10],[8,9],[10,11],
  ];
  // Dodecahedron vertices (dual)
  const a = 1/phi, b = phi;
  const dodVerts = [
    [1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1],
    [0,a,b],[0,a,-b],[0,-a,b],[0,-a,-b],
    [a,b,0],[a,-b,0],[-a,b,0],[-a,-b,0],
    [b,0,a],[b,0,-a],[-b,0,a],[-b,0,-a],
  ].map(v => { const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); return v.map(c => c/l * 150); });
  const dodEdges = [
    [0,8],[0,12],[0,16],[8,4],[8,10],[4,14],[4,18],[10,2],[10,6],
    [2,13],[2,16],[6,15],[6,18],[12,1],[12,14],[14,5],[16,17],
    [1,9],[1,17],[5,9],[5,19],[17,3],[3,11],[3,13],[9,11],
    [11,7],[7,15],[7,19],[13,15],[18,19],
  ];
  _polyhedra = {
    ico: { verts: icoVerts, edges: icoEdges },
    dod: { verts: dodVerts, edges: dodEdges },
    rotX: 0, rotY: 0, rotZ: 0,
    morphT: 0,
  };
}

export function resetPolyhedra() {
  _polyhedra = null;
}

export function renderHyperPolyhedra(ctx, w, h, t, bands) {
  if (!_polyhedra) initPolyhedra();
  const P = _polyhedra;
  const cx = w/2, cy = h/2, time = t * 0.001;
  const bass = bands.bass||0, mid = bands.mid||0, highMid = bands.highMid||0;
  const pres = bands.presence||0, brill = bands.brilliance||0, lowMid = bands.lowMid||0;

  // Rotate on 3 axes — audio reactive speeds
  P.rotX += 0.004 * (1 + bass * 3);
  P.rotY += 0.006 * (1 + mid * 2);
  P.rotZ += 0.002 * (1 + highMid * 2.5);

  // Morph parameter
  P.morphT += 0.002 * (1 + lowMid * 3);
  const morphBlend = (Math.sin(P.morphT) + 1) / 2; // 0-1 oscillation

  const project = (v3) => {
    let [x, y, z] = v3;
    // Rotate X
    let y1 = y*Math.cos(P.rotX) - z*Math.sin(P.rotX);
    let z1 = y*Math.sin(P.rotX) + z*Math.cos(P.rotX);
    // Rotate Y
    let x2 = x*Math.cos(P.rotY) + z1*Math.sin(P.rotY);
    let z2 = -x*Math.sin(P.rotY) + z1*Math.cos(P.rotY);
    // Rotate Z
    let x3 = x2*Math.cos(P.rotZ) - y1*Math.sin(P.rotZ);
    let y3 = x2*Math.sin(P.rotZ) + y1*Math.cos(P.rotZ);
    // Perspective
    const scale = (1 + bass * 0.6) * Math.min(w,h) / 500;
    const perspective = 600 / (600 + z2);
    return { x: cx + x3 * perspective * scale, y: cy + y3 * perspective * scale, z: z2, p: perspective };
  };

  // Morphing: blend between ico and dod vertex positions for shared indices
  const drawShape = (shape, scaleMul, hueBase, alphaBase) => {
    const verts = shape.verts.map(v => {
      // Add noise-based vertex displacement
      const nx = simplex.noise3D(v[0]*0.01, v[1]*0.01, time*0.5) * 15 * (1+mid);
      const ny = simplex.noise3D(v[1]*0.01, v[2]*0.01, time*0.5) * 15 * (1+mid);
      const nz = simplex.noise3D(v[0]*0.01, v[2]*0.01, time*0.5) * 15 * (1+mid);
      return [v[0]*scaleMul + nx, v[1]*scaleMul + ny, v[2]*scaleMul + nz];
    });
    const projected = verts.map(project);

    // Draw edges
    shape.edges.forEach(([a, b], ei) => {
      const pa = projected[a], pb = projected[b];
      const avgZ = (pa.z + pb.z) / 2;
      const depthAlpha = 0.3 + (1 - (avgZ + 200) / 400) * 0.7;
      const bandVal = ei % 3 === 0 ? bass : ei % 3 === 1 ? mid : highMid;
      const edgeAlpha = alphaBase * depthAlpha * (0.3 + bandVal * 0.7);
      const edgeHue = hueBase + ei * 2 + bandVal * 40;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = hsl(edgeHue, 50 + pres * 30, 50 + brill * 20, edgeAlpha);
      ctx.lineWidth = (0.5 + bandVal * 2.5) * pa.p;
      ctx.stroke();
    });

    // Draw vertices as glowing points
    projected.forEach((p, vi) => {
      const depthAlpha = 0.5 + (1 - (p.z + 200) / 400) * 0.5;
      const pulse = 0.5 + Math.sin(time * 4 + vi * 0.7) * 0.5;
      const vSize = (2 + pres * 6 + highMid * 4) * p.p * pulse;
      const va = alphaBase * depthAlpha * (0.3 + pulse * 0.7);
      const vg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, vSize * 3);
      vg.addColorStop(0, hsl(hueBase + vi * 3, 70, 75, va));
      vg.addColorStop(0.5, hsl(hueBase + vi * 3, 50, 55, va * 0.3));
      vg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = vg; ctx.beginPath(); ctx.arc(p.x, p.y, vSize * 3, 0, Math.PI * 2); ctx.fill();
    });
  };

  // Draw dodecahedron (inner, smaller)
  const dodAlpha = 0.15 + lowMid * 0.25;
  drawShape(P.dod, 0.9 + morphBlend * 0.3, 30, dodAlpha);

  // Draw icosahedron (outer, larger)
  const icoAlpha = 0.15 + mid * 0.25;
  drawShape(P.ico, 1.1 - morphBlend * 0.2, 45, icoAlpha);

  // Connecting energy lines between shapes on bass hits
  if (bass > 0.4) {
    const icoP = P.ico.verts.map(v => project(v.map(c => c * (1.1 - morphBlend*0.2))));
    const dodP = P.dod.verts.map(v => project(v.map(c => c * (0.9 + morphBlend*0.3))));
    for (let i = 0; i < Math.min(icoP.length, dodP.length); i++) {
      const a = icoP[i], b = dodP[i];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = hsl(40, 50, 60, 0.02 + bass * 0.06);
      ctx.lineWidth = 0.5; ctx.stroke();
    }
  }

  // Outer rotating ring of particles
  for (let i = 0; i < 40; i++) {
    const angle = (i/40) * Math.PI * 2 + time * 0.2;
    const ringR = Math.min(w,h) * 0.35 * (1 + bass * 0.3);
    const wobble = simplex.noise2D(i * 2, time) * 20;
    const rx = cx + Math.cos(angle) * (ringR + wobble);
    const ry = cy + Math.sin(angle) * (ringR + wobble) * 0.5;
    const twinkle = 0.5 + Math.sin(time * 5 + i * 4) * 0.5;
    ctx.fillStyle = hsl(45, 50, 70, (0.03 + brill * 0.15) * twinkle);
    ctx.beginPath(); ctx.arc(rx, ry, 1 + brill * 2, 0, Math.PI * 2); ctx.fill();
  }
}
