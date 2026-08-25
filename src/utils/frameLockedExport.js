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

   Audio is rendered — and handed to the muxer, then closed — in full
   BEFORE any video frame is drawn. Mediabunny's muxer won't write out
   ANY track's data until every track has something queued (it's
   interleaving by timestamp), so if audio only arrives as one chunk
   after the whole video loop, every encoded video frame sits buffered
   in memory for the entire export — for a multi-minute song at high
   bitrate that's multiple GB, and it can hang or crash the tab before
   ever producing a file. Feeding audio first (then closing that track)
   lets the muxer flush video frames to the output as they're encoded,
   instead of hoarding the whole thing.

   Audio itself is ALSO rendered in bounded-size chunks (~CHUNK_SEC each)
   rather than one OfflineAudioContext spanning the whole song. An
   OfflineAudioContext pre-allocates a buffer sized for its entire given
   length up front — for a long playlist on a high loop count (an hour+
   of total audio) that's over a gigabyte for a single allocation, enough
   to crash the tab outright even with the fixes above. Chunk boundaries
   are chosen to always land in a track's "solo" stretch — never inside a
   crossfade — so each chunk can be scheduled independently using plain
   arithmetic derived from the one full-timeline schedule computed up
   front (via a throwaway, unrendered OfflineAudioContext just to get
   mixer.js's per-track math without paying for a real render).
   ═══════════════════════════════════════════════════════════ */
import {
  Output, WebMOutputFormat, BufferTarget,
  CanvasSource, AudioBufferSource,
  canEncodeVideo,
} from "mediabunny";
import { createMixer } from "./mixer.js";
import { analyzeBands } from "./audio.js";

const AUDIO_FADE_SEC = 15; // must match the visual fade-to-black duration in drawFrame
const CHUNK_SEC = 240; // target audio-chunk length; bounds peak memory regardless of song length

export async function isFrameLockedExportSupported(width, height) {
  try {
    return await canEncodeVideo("vp9", { width, height });
  } catch (e) {
    return false;
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
  const bandsPerFrame = new Array(totalFrames);
  const fadeStart = Math.max(0, totalDuration - AUDIO_FADE_SEC);

  // ─── Set up the output/tracks first so audio chunks can be fed to the
  // muxer as they're rendered (see file header for why audio must be fully
  // queued — and its track closed — before any video frame is drawn).
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });

  const videoSource = new CanvasSource(canvas, { codec: "vp9", bitrate: videoBitrate });
  output.addVideoTrack(videoSource);

  let audioSource = null;
  if (hasAudio) {
    audioSource = new AudioBufferSource({ codec: "opus", bitrate: audioBitrate });
    output.addAudioTrack(audioSource);
  }

  await output.start();

  // ─── Pass 1: render audio chunk by chunk, capturing the AnalyserNode's
  // bands at each frame's exact timestamp along the way — nothing is drawn
  // yet. Each chunk's rendered audio is fed to the muxer immediately and
  // then dropped, so peak memory stays bounded by CHUNK_SEC, not song length.
  if (hasAudio) {
    const bounds = computeChunkBoundaries(schedule, effectiveCrossfade, totalDuration);

    for (let c = 0; c < bounds.length - 1; c++) {
      const chunkStart = bounds[c], chunkEnd = bounds[c + 1];
      const chunkDur = chunkEnd - chunkStart;
      if (chunkDur <= 0) continue;

      const chunkCtx = new OfflineAudioContext(2, Math.ceil(chunkDur * sampleRate) + 1, sampleRate);
      const { analyser } = buildChunkGraph(chunkCtx, tracks, schedule, { crossfade: effectiveCrossfade, chunkStart, chunkEnd, fadeStart, totalDuration });

      const idxStart = Math.max(0, Math.ceil(chunkStart * fps - 1e-9));
      const idxEnd = Math.min(totalFrames, Math.ceil(chunkEnd * fps - 1e-9));
      const localSuspendFor = (i) => Math.max(i / fps - chunkStart, 0.0001);

      let pendingSuspend = idxStart < idxEnd ? chunkCtx.suspend(localSuspendFor(idxStart)) : null;
      const renderedPromise = chunkCtx.startRendering();

      for (let i = idxStart; i < idxEnd; i++) {
        if (shouldAbort && shouldAbort()) throw new DOMException("Export aborted", "AbortError");
        await pendingSuspend;
        bandsPerFrame[i] = analyzeBands(analyser, sampleRate);
        if (i + 1 < idxEnd) pendingSuspend = chunkCtx.suspend(localSuspendFor(i + 1));
        chunkCtx.resume();
        // Audio pre-render is usually much faster than the draw+encode pass
        // below, so it only claims the first slice of the progress bar —
        // otherwise it'd sit at 0% for a while on a long song and look stuck.
        if (onProgress) onProgress((i + 1) / totalFrames * 0.2);
        if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0));
      }

      const chunkRendered = await renderedPromise;
      await audioSource.add(chunkRendered);
    }

    audioSource.close();
  } else {
    for (let i = 0; i < totalFrames; i++) bandsPerFrame[i] = analyzeBands(null, sampleRate);
  }

  // ─── Pass 2: draw + encode each video frame, using the bands captured
  // above. Audio is already fully queued and closed, so the muxer can
  // interleave and flush video frames to the output as they're encoded
  // instead of buffering the entire video in memory.
  // drawFrame only ever reads .schedule off this (per-track background
  // crossfades, dynamic title lookup) — no need for a real mixer/audio graph.
  const scheduleInfo = hasAudio ? { schedule, totalDuration } : null;

  for (let i = 0; i < totalFrames; i++) {
    if (shouldAbort && shouldAbort()) {
      await output.cancel();
      throw new DOMException("Export aborted", "AbortError");
    }

    const t = i / fps;
    await drawFrame(ctx, { elapsed: t * 1000, playhead: t, bands: bandsPerFrame[i], mixer: scheduleInfo, frameIndex: i, totalFrames, totalDuration });
    await videoSource.add(t, 1 / fps);

    if (onProgress) onProgress(0.2 + (i + 1) / totalFrames * 0.8);

    // Yield to the event loop periodically so the UI (progress %) can repaint.
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  await output.finalize();
  return { blob: new Blob([target.buffer], { type: "video/webm" }), totalDuration };
}
