/* ═══════════════════════════════════════════════════════════
   PLAYLIST MIXER — Beat-matched Crossfade
   ───────────────────────────────────────────────────────────
   - BPM detection via low-pass envelope autocorrelation
   - Equal-power crossfade (sin/cos curves)
   - Tempo match: if BPMs within ±14%, playbackRate of incoming
     snaps to outgoing's tempo
   - Filter sweep during crossfade: outgoing loses highs,
     incoming opens from muffled → full — hides transient clash
   ═══════════════════════════════════════════════════════════ */

// Detect BPM from an AudioBuffer. Returns integer BPM in [60, 180].
export async function detectBPM(buffer) {
  try {
    const sr = buffer.sampleRate;
    // Analyze at most first 60 seconds for speed
    const analyzeLen = Math.min(buffer.length, Math.floor(sr * 60));
    const offline = new OfflineAudioContext(1, analyzeLen, sr);
    const src = offline.createBufferSource();
    src.buffer = buffer;
    const lp = offline.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 150;
    src.connect(lp);
    lp.connect(offline.destination);
    src.start(0);
    const rendered = await offline.startRendering();
    const data = rendered.getChannelData(0);

    // Envelope: windowed RMS, 20ms windows
    const winSize = Math.floor(sr * 0.02);
    const envLen = Math.floor(data.length / winSize);
    const env = new Float32Array(envLen);
    for (let i = 0; i < envLen; i++) {
      let s = 0;
      const base = i * winSize;
      for (let j = 0; j < winSize; j++) s += data[base + j] * data[base + j];
      env[i] = Math.sqrt(s / winSize);
    }
    // Normalize
    let mx = 0;
    for (let i = 0; i < envLen; i++) if (env[i] > mx) mx = env[i];
    if (mx > 0) for (let i = 0; i < envLen; i++) env[i] /= mx;

    // Autocorrelation on envelope
    const envPerSec = sr / winSize;
    const minBPM = 60, maxBPM = 180;
    const minLag = Math.max(1, Math.floor((60 / maxBPM) * envPerSec));
    const maxLag = Math.min(envLen - 1, Math.floor((60 / minBPM) * envPerSec));

    let bestLag = minLag, bestCorr = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      const n = envLen - lag;
      for (let i = 0; i < n; i++) c += env[i] * env[i + lag];
      // Slight preference for 90-140 range (most music)
      const bpm = 60 / (lag / envPerSec);
      const bias = (bpm >= 90 && bpm <= 140) ? 1.05 : 1.0;
      const score = c * bias;
      if (score > bestCorr) { bestCorr = score; bestLag = lag; }
    }
    let bpm = 60 / (bestLag / envPerSec);
    // Fold extremes toward 80–160 range
    while (bpm < 70) bpm *= 2;
    while (bpm > 170) bpm /= 2;
    return Math.round(bpm);
  } catch (e) {
    console.warn("BPM detect failed", e);
    return 0;
  }
}

/* Build and schedule a crossfaded playlist. Returns an object with
   analyser, totalDuration (s), schedule[], and stop().
   Tracks: [{ buffer, bpm, name }] — bpm optional (0 = unknown) */
export function createMixer(audioCtx, tracks, opts = {}) {
  const crossfade = Math.max(2, opts.crossfade ?? 10);
  const startDelay = opts.startDelay ?? 0.15;
  // opts.startTime lets caller schedule the exact absolute start (for seamless loop crossfade)
  const mixStart = opts.startTime ?? (audioCtx.currentTime + startDelay);

  // Master chain → analyser → destinations (multiple allowed)
  const master = audioCtx.createGain();
  master.gain.value = 1;
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;               // ~23ms window (vs 46ms) → faster beat response
  analyser.smoothingTimeConstant = 0.55; // less smoothing → visual tracks beat tighter
  master.connect(analyser);

  const extraDestinations = opts.destinations || [];
  if (opts.connectDestination !== false) extraDestinations.push(audioCtx.destination);
  extraDestinations.forEach(d => { try { analyser.connect(d); } catch (e) {} });

  const sources = [];
  const schedule = [];
  let cursorAbs = mixStart;         // absolute audioCtx time the next track plays
  let offsetSec = 0;                 // playhead offset from mixStart (effective)

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const prev = tracks[i - 1];

    // Tempo-match: only snap if ratio within tolerance (avoids chipmunk)
    let rate = 1;
    if (prev && prev.bpm && t.bpm) {
      const r = prev.bpm / t.bpm;
      if (r >= 0.86 && r <= 1.16) rate = r;
    }

    const src = audioCtx.createBufferSource();
    src.buffer = t.buffer;
    src.playbackRate.value = rate;

    const g = audioCtx.createGain();
    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 22000;
    lp.Q.value = 0.707;

    src.connect(lp);
    lp.connect(g);
    g.connect(master);

    const playDur = t.buffer.duration / rate;           // real seconds
    const startAbs = i === 0 ? cursorAbs : cursorAbs - crossfade;
    const offsetFromMix = startAbs - mixStart;

    // Equal-power fade curves (64 points)
    const steps = 64;
    const fadeIn = new Float32Array(steps);
    const fadeOut = new Float32Array(steps);
    for (let k = 0; k < steps; k++) {
      const x = k / (steps - 1);
      fadeIn[k] = Math.sin(x * Math.PI / 2);
      fadeOut[k] = Math.cos(x * Math.PI / 2);
    }

    if (i === 0) {
      g.gain.setValueAtTime(1, startAbs);
    } else {
      // Crossfade in at startAbs … startAbs+crossfade
      g.gain.setValueAtTime(0.0001, startAbs);
      g.gain.setValueCurveAtTime(fadeIn, startAbs, crossfade);
      // Filter opens from muffled → full during crossfade
      lp.frequency.setValueAtTime(380, startAbs);
      lp.frequency.exponentialRampToValueAtTime(22000, startAbs + crossfade);
    }

    // Crossfade out at end if there is a next track
    if (i < tracks.length - 1) {
      const fadeOutStart = startAbs + playDur - crossfade;
      g.gain.setValueAtTime(1, fadeOutStart);
      g.gain.setValueCurveAtTime(fadeOut, fadeOutStart, crossfade);
      // Filter closes over the outgoing track so highs bleed out
      lp.frequency.setValueAtTime(22000, fadeOutStart);
      lp.frequency.exponentialRampToValueAtTime(550, fadeOutStart + crossfade);
    }

    src.start(startAbs);
    sources.push(src);
    schedule.push({
      index: i,
      name: t.name || "",
      bpm: t.bpm || 0,
      rate,
      startOffset: offsetFromMix,
      duration: playDur,
    });

    cursorAbs = startAbs + playDur;
    offsetSec = cursorAbs - mixStart;
  }

  return {
    analyser,
    master,
    sources,
    schedule,
    mixStart,
    totalDuration: offsetSec,
    stop() {
      sources.forEach(s => { try { s.stop(); } catch (e) {} });
      try { master.disconnect(); } catch (e) {}
      try { analyser.disconnect(); } catch (e) {}
    },
  };
}

// Given schedule + playhead seconds, return currently active track entry.
export function currentTrack(schedule, playheadSec) {
  if (!schedule || schedule.length === 0) return null;
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (playheadSec >= schedule[i].startOffset) return schedule[i];
  }
  return schedule[0];
}
