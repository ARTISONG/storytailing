/* ═══════════════════════════════════════════════════════════
   FRAME-LOCKED EXPORT — WebCodecs-based, non-real-time render
   ───────────────────────────────────────────────────────────
   The old export path sampled a live canvas on a wall-clock timer
   (MediaRecorder + captureStream). When a frame took longer than its
   1/30s budget to draw (many effects stacked), the sampler grabbed the
   same still-unfinished frame twice → duplicated/frozen frames in the
   output = visible stutter, worse the more effects are enabled.

   This module draws + encodes each output frame at a fixed timestep
   instead. A slow machine just makes the export take longer wall-clock
   time — frame pacing is never tied to how fast the CPU can draw, so
   the result can never come out stuttery.

   The audio track is rendered offline (OfflineAudioContext) through the
   same mixer graph used for live playback. Its AnalyserNode is sampled
   via suspend()/resume() at each frame's exact timestamp, so the bands
   fed to the visualizers match what the live AnalyserNode would report
   at that instant — visual behaviour stays identical to the live preview.

   ── Everything here is sized by CHUNK, never by playlist length ──
   A long multi-song export used to end with no file and no error at all,
   or take the tab down with it. Three separate things grew with total
   duration; all three are now bounded:

   1. THE OUTPUT FILE. It accumulated in mediabunny's BufferTarget, which
      holds the whole .webm in one ArrayBuffer, grows it by DOUBLING, and
      copies the lot again on finalize — so peak RAM ran ~3x the finished
      file, and past 4 GiB it throws outright ("ArrayBuffer exceeded
      maximum size"). At the 4K bitrate that ceiling arrives about seven
      minutes in. The muxer now streams straight to a scratch file in the
      origin-private file system: RAM no longer tracks output size, and
      there's no size ceiling.

   2. THE AUDIO RENDER. An OfflineAudioContext pre-allocates a buffer for
      its entire given length up front — an hour of audio is over a
      gigabyte in a single allocation. Audio is rendered in ~CHUNK_SEC
      slices instead. Chunk boundaries always land in a track's "solo"
      stretch — never inside a crossfade — so each chunk can be scheduled
      independently using plain arithmetic derived from the one
      full-timeline schedule computed up front (via a throwaway,
      unrendered OfflineAudioContext just to get mixer.js's per-track math
      without paying for a real render).

   3. THE CAPTURED SPECTRUM. analyzeBands() hands back two 512-byte arrays
      per frame; holding them for a whole playlist is hundreds of MB.
      Audio-render and draw+encode therefore run interleaved per chunk, so
      only one chunk's worth of bands is ever live. Interleaving is also
      what keeps the muxer flushing: it can only write out up to the
      earliest timestamp that EVERY track has reached, so feeding both
      tracks chunk by chunk lets encoded video reach the disk continuously
      instead of piling up inside the muxer.
   ═══════════════════════════════════════════════════════════ */
import {
  Output, WebMOutputFormat, BufferTarget, StreamTarget,
  CanvasSource, AudioBufferSource,
  canEncodeVideo,
} from "mediabunny";
import { createMixer } from "./mixer.js";
import { analyzeBands } from "./audio.js";

const AUDIO_FADE_SEC = 15; // must match the visual fade-to-black duration in drawFrame
const CHUNK_SEC = 240; // target audio-chunk length; bounds peak memory regardless of song length
const SCRATCH_PREFIX = "storytailing-render-";

export async function isFrameLockedExportSupported(width, height) {
  try {
    return await canEncodeVideo("vp9", { width, height });
  } catch (e) {
    return false;
  }
}

// Opens a scratch file in the origin-private file system and wraps it as a
// mediabunny StreamTarget, so the muxer writes the growing .webm to disk as it
// goes (point 1 in the header covers why the in-memory target can't carry a
// long export). Returns null when OPFS isn't available, in which case the
// caller falls back to BufferTarget and its 4 GiB ceiling.
async function openScratchTarget() {
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  try {
    const dir = await navigator.storage.getDirectory();
    const name = `${SCRATCH_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`;
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    return { target: new StreamTarget(writable, { chunked: true }), dir, handle, name };
  } catch (e) {
    return null;
  }
}

/* Deletes scratch renders left behind by a crashed or force-closed export.
   Call once at app start: at that point no download in this session can still
   be reading one, because this session's own scratch files are created later. */
export async function sweepExportScratch() {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return;
    const dir = await navigator.storage.getDirectory();
    const stale = [];
    for await (const name of dir.keys()) if (name.startsWith(SCRATCH_PREFIX)) stale.push(name);
    for (const name of stale) {
      try { await dir.removeEntry(name); } catch (e) { /* still locked — next run gets it */ }
    }
  } catch (e) {
    // No OPFS, or it can't be enumerated here — nothing to clean up.
  }
}

// Nudges a target chunk-boundary time to the nearest point that isn't inside
// any track's crossfade window, so a chunk can always be scheduled with
// simple "steady gain" edges — no automation curve ever needs to be split
// across a chunk boundary.
function nearestSafeBoundary(schedule, crossfade, totalDuration, target) {
  if (target >= totalDuration) return totalDuration;
  for (const tr of schedule) {
    const trStart = tr.startOffset, trEnd = trStart + tr.duration;
    if (target < trStart || target >= trEnd) continue;
    const safeStart = trStart + (tr.index > 0 ? crossfade : 0);
    const safeEnd = trEnd - (tr.index < schedule.length - 1 ? crossfade : 0);
    if (safeStart >= safeEnd) return trEnd; // track too short to have a safe middle — just take it whole
    if (target < safeStart) return safeStart;
    if (target > safeEnd) return safeEnd;
    return target;
  }
  return totalDuration;
}

function computeChunkBoundaries(schedule, crossfade, totalDuration) {
  const bounds = [0];
  let t = 0;
  while (t < totalDuration) {
    const next = nearestSafeBoundary(schedule, crossfade, totalDuration, Math.min(totalDuration, t + CHUNK_SEC));
    bounds.push(next);
    t = next;
  }
  return bounds;
}

// Builds the mixer graph for just [chunkStart, chunkEnd) into chunkCtx,
// reusing the rate/timing already worked out in `schedule` (from the
// full-timeline throwaway pass) instead of recomputing tempo-match. Tracks
// that started in an earlier chunk resume mid-buffer via the source node's
// offset param; tracks whose fade lies entirely in this chunk get the same
// equal-power crossfade curves mixer.js uses for live playback.
function buildChunkGraph(chunkCtx, tracks, schedule, { crossfade, chunkStart, chunkEnd, fadeStart, totalDuration }) {
  const master = chunkCtx.createGain();
  const analyser = chunkCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.55;
  master.connect(analyser);
  const fadeGain = chunkCtx.createGain();
  analyser.connect(fadeGain);
  fadeGain.connect(chunkCtx.destination);

  const steps = 64;
  const fadeIn = new Float32Array(steps);
  const fadeOut = new Float32Array(steps);
  for (let k = 0; k < steps; k++) {
    const x = k / (steps - 1);
    fadeIn[k] = Math.sin(x * Math.PI / 2);
    fadeOut[k] = Math.cos(x * Math.PI / 2);
  }

  for (const tr of schedule) {
    const trStart = tr.startOffset, trEnd = trStart + tr.duration;
    if (trEnd <= chunkStart || trStart >= chunkEnd) continue; // not audible in this chunk

    const track = tracks[tr.index];
    const isContinuing = trStart < chunkStart;
    const localWhen = Math.max(0, trStart - chunkStart);
    const bufferOffsetSec = isContinuing ? (chunkStart - trStart) * tr.rate : 0;

    const src = chunkCtx.createBufferSource();
    src.buffer = track.buffer;
    src.playbackRate.value = tr.rate;

    const g = chunkCtx.createGain();
    const lp = chunkCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.707;
    src.connect(lp);
    lp.connect(g);
    g.connect(master);

    const hasPrev = tr.index > 0;
    const hasNext = tr.index < schedule.length - 1;

    if (isContinuing) {
      // Whatever fade-in this track had already finished before this chunk
      // started (guaranteed by the safe-boundary choice) — just steady on.
      g.gain.setValueAtTime(1, 0);
      lp.frequency.setValueAtTime(22000, 0);
    } else if (hasPrev) {
      g.gain.setValueAtTime(0.0001, localWhen);
      g.gain.setValueCurveAtTime(fadeIn, localWhen, crossfade);
      lp.frequency.setValueAtTime(380, localWhen);
      lp.frequency.exponentialRampToValueAtTime(22000, localWhen + crossfade);
    } else {
      g.gain.setValueAtTime(1, localWhen);
      lp.frequency.setValueAtTime(22000, localWhen);
    }

    if (hasNext) {
      const fadeOutStartAbs = trEnd - crossfade;
      if (fadeOutStartAbs >= chunkStart && fadeOutStartAbs < chunkEnd) {
        const localFadeOutStart = fadeOutStartAbs - chunkStart;
        g.gain.setValueAtTime(1, localFadeOutStart);
        g.gain.setValueCurveAtTime(fadeOut, localFadeOutStart, crossfade);
        lp.frequency.setValueAtTime(22000, localFadeOutStart);
        lp.frequency.exponentialRampToValueAtTime(550, localFadeOutStart + crossfade);
      }
    }

    src.start(localWhen, bufferOffsetSec);
  }

  // End-of-video audio fade-to-black — a plain linear ramp, so (unlike the
  // equal-power crossfades above) it's fine if it happens to straddle a
  // chunk boundary; just resume from the interpolated value.
  if (fadeStart < chunkEnd) {
    let startVal = 1, localStart = 0;
    if (fadeStart < chunkStart) {
      const frac = Math.min(1, (chunkStart - fadeStart) / AUDIO_FADE_SEC);
      startVal = 1 + (0.0001 - 1) * frac;
    } else {
      localStart = fadeStart - chunkStart;
    }
    fadeGain.gain.setValueAtTime(startVal, localStart);
    const localEnd = Math.min(chunkEnd, totalDuration) - chunkStart;
    if (localEnd > localStart) fadeGain.gain.linearRampToValueAtTime(0.0001, localEnd);
  } else {
    fadeGain.gain.setValueAtTime(1, 0);
  }

  return { analyser };
}

/**
 * tracks: loop-expanded, ready (buffer-decoded) track list — or [] for a
 * video-only export (fallbackDuration is used for length in that case).
 * drawFrame(ctx, info) draws ONE full frame onto ctx — same contract as
 * the old real-time render() body — where info is:
 *   { elapsed (ms), playhead (s), bands, mixer, frameIndex, totalFrames, totalDuration }
 */
export async function exportFrameLocked({
  width, height, fps = 30,
  tracks, crossfade, fallbackDuration = 60,
  videoBitrate = 20_000_000, audioBitrate = 160_000,
  drawFrame, onProgress, shouldAbort,
}) {
  const hasAudio = !!(tracks && tracks.length > 0);
  const sampleRate = hasAudio ? (tracks[0].buffer.sampleRate || 48000) : 48000;
  // mixer.js clamps crossfade to a 2s floor internally, and the schedule's
  // startOffset/duration numbers are computed using that clamped value — so
  // our own boundary/graph math below must match it exactly, not the raw
  // caller-supplied value, or chunk safety margins would disagree with what
  // the schedule actually reflects.
  const effectiveCrossfade = Math.max(2, crossfade ?? 10);

  // Throwaway, never-rendered context: just to get mixer.js's per-track
  // timing/tempo-match math (schedule + totalDuration) without paying for
  // a real render buffer sized to the whole song.
  let schedule = null, totalDuration = fallbackDuration;
  if (hasAudio) {
    const probeCtx = new OfflineAudioContext(2, 1, sampleRate);
    const probeMixer = createMixer(probeCtx, tracks, { crossfade, startTime: 0, connectDestination: false });
    schedule = probeMixer.schedule;
    totalDuration = probeMixer.totalDuration;
  }

  const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));
  const fadeStart = Math.max(0, totalDuration - AUDIO_FADE_SEC);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const scratch = await openScratchTarget();
  const bufferTarget = scratch ? null : new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target: scratch ? scratch.target : bufferTarget });

  const videoSource = new CanvasSource(canvas, { codec: "vp9", bitrate: videoBitrate });
  output.addVideoTrack(videoSource);

  let audioSource = null;
  if (hasAudio) {
    audioSource = new AudioBufferSource({ codec: "opus", bitrate: audioBitrate });
    output.addAudioTrack(audioSource);
  }

  // drawFrame only ever reads .schedule off this (per-track background
  // crossfades, dynamic title lookup) — no need for a real mixer/audio graph.
  const scheduleInfo = hasAudio ? { schedule, totalDuration } : null;
  const bail = () => { throw new DOMException("Export aborted", "AbortError"); };

  let finalized = false;
  try {
    await output.start();

    // One chunk at a time: render its audio (capturing the AnalyserNode's
    // bands at each frame's exact timestamp), hand that audio to the muxer,
    // then draw + encode exactly the frames that chunk covers. Nothing that
    // scales with total playlist length is ever held.
    const bounds = hasAudio
      ? computeChunkBoundaries(schedule, effectiveCrossfade, totalDuration)
      : [0, totalDuration];

    let analyzed = 0, encoded = 0;
    // Audio pre-render is much cheaper than draw+encode, so it only claims a
    // thin slice of the bar — otherwise a long song would sit near 0% for a
    // while at each chunk and look stuck.
    const report = () => {
      if (onProgress) onProgress(Math.min(1, (analyzed * 0.15 + encoded * 0.85) / totalFrames));
    };

    for (let c = 0; c < bounds.length - 1; c++) {
      const chunkStart = bounds[c], chunkEnd = bounds[c + 1];
      const chunkDur = chunkEnd - chunkStart;
      if (chunkDur <= 0) continue;

      const isLast = c === bounds.length - 2;
      const idxStart = Math.max(0, Math.ceil(chunkStart * fps - 1e-9));
      // The final chunk always runs to the last frame, so rounding can never
      // leave a frame with no captured bands for the draw pass below.
      const idxEnd = isLast ? totalFrames : Math.min(totalFrames, Math.ceil(chunkEnd * fps - 1e-9));
      const chunkBands = new Array(Math.max(0, idxEnd - idxStart));

      if (hasAudio) {
        const chunkCtx = new OfflineAudioContext(2, Math.ceil(chunkDur * sampleRate) + 1, sampleRate);
        const { analyser } = buildChunkGraph(chunkCtx, tracks, schedule, { crossfade: effectiveCrossfade, chunkStart, chunkEnd, fadeStart, totalDuration });

        // Keep suspend() times inside the chunk's own render length — the last
        // chunk's frame grid can round a hair past chunkEnd.
        const maxSuspend = Math.max(0.0001, chunkDur - 1 / sampleRate);
        const localSuspendFor = (i) => Math.min(maxSuspend, Math.max(i / fps - chunkStart, 0.0001));

        let pendingSuspend = idxStart < idxEnd ? chunkCtx.suspend(localSuspendFor(idxStart)) : null;
        const renderedPromise = chunkCtx.startRendering();

        for (let i = idxStart; i < idxEnd; i++) {
          if (shouldAbort && shouldAbort()) bail();
          await pendingSuspend;
          chunkBands[i - idxStart] = analyzeBands(analyser, sampleRate);
          if (i + 1 < idxEnd) pendingSuspend = chunkCtx.suspend(localSuspendFor(i + 1));
          chunkCtx.resume();
          analyzed++;
          report();
          if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0));
        }

        const chunkRendered = await renderedPromise;
        await audioSource.add(chunkRendered);
      } else {
        for (let i = idxStart; i < idxEnd; i++) chunkBands[i - idxStart] = analyzeBands(null, sampleRate);
      }

      for (let i = idxStart; i < idxEnd; i++) {
        if (shouldAbort && shouldAbort()) bail();
        const t = i / fps;
        await drawFrame(ctx, { elapsed: t * 1000, playhead: t, bands: chunkBands[i - idxStart], mixer: scheduleInfo, frameIndex: i, totalFrames, totalDuration });
        await videoSource.add(t, 1 / fps);
        chunkBands[i - idxStart] = null; // drop the ~1 KB of spectrum this frame held
        encoded++;
        report();
        // Yield to the event loop periodically so the UI (progress %) can repaint.
        if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (audioSource) audioSource.close();
    await output.finalize();
    finalized = true;
  } catch (err) {
    if (!finalized) { try { await output.cancel(); } catch (e) { /* already torn down */ } }
    if (scratch) { try { await scratch.dir.removeEntry(scratch.name); } catch (e) { /* swept at next start */ } }
    throw err;
  }

  if (scratch) {
    // A File from OPFS is backed by that on-disk file, not by a copy in
    // memory — so handing it to URL.createObjectURL() downloads it straight
    // off disk however large it grew.
    return { blob: await scratch.handle.getFile(), totalDuration };
  }
  return { blob: new Blob([bufferTarget.buffer], { type: "video/webm" }), totalDuration };
}
