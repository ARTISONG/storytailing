/* ═══════════════════════════════════════════════════════════
   AUDIO ANALYZER — 7-band
   ═══════════════════════════════════════════════════════════ */
const BANDS = { subBass:[20,60], bass:[60,250], lowMid:[250,500], mid:[500,2000], highMid:[2000,4000], presence:[4000,8000], brilliance:[8000,20000] };

export function analyzeBands(analyser, sr) {
  if (!analyser) return { subBass:0,bass:0,lowMid:0,mid:0,highMid:0,presence:0,brilliance:0,overall:0,waveform:null };
  const n = analyser.frequencyBinCount, freq = new Uint8Array(n), wave = new Uint8Array(n);
  analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave);
  const bHz = sr / (n * 2);
  const get = ([lo,hi]) => { const s = Math.max(0,Math.floor(lo/bHz)), e = Math.min(n-1,Math.ceil(hi/bHz)); let sum=0,c=0; for(let i=s;i<=e;i++){sum+=freq[i];c++} return c>0?(sum/c)/255:0; };
  const b = {}; let tot=0,cnt=0;
  for (const [k,r] of Object.entries(BANDS)) { b[k]=get(r); tot+=b[k]; cnt++; }
  b.overall=tot/cnt; b.waveform=wave; return b;
}

export function hsl(h, s, l, a = 1) {
  return `hsla(${((h % 360) + 360) % 360},${Math.max(0, Math.min(100, s))}%,${Math.max(0, Math.min(100, l))}%,${a})`;
}
