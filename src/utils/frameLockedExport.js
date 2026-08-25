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
   ═══════════════════════════════════════════════════════════ */
import {
  Output, WebMOutputFormat, BufferTarget,
  CanvasSource, AudioBufferSource,
  canEncodeVideo,
} from "mediabunny";
import { createMixer } from "./mixer.js";
import { analyzeBands } from "./audio.js";

const AUDIO_FADE_SEC = 15; // must match the visual fade-to-black duration in drawFrame

export async function isFrameLockedExportSupported(width, height) {
  try {
    return await canEncodeVideo("vp9", { width, height });
  } catch (e) {
    return false;
  }
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

  let offlineCtx = null, mixer = null, totalDuration = fallbackDuration;
  if (hasAudio) {
    const upperBoundSec = tracks.reduce((s, t) => s + t.buffer.duration, 0) + 2;
    offlineCtx = new OfflineAudioContext(2, Math.ceil(upperBoundSec * sampleRate), sampleRate);

    // Fade gain sits between the mixer's analyser and the offline
    // destination, mirroring the live export's end-of-video audio fade
    // (previously driven in real time via a GainNode on actx.destination).
    const fadeGain = offlineCtx.createGain();
    fadeGain.connect(offlineCtx.destination);
    mixer = createMixer(offlineCtx, tracks, {
      crossfade, startTime: 0, connectDestination: false, destinations: [fadeGain],
    });
    totalDuration = mixer.totalDuration;
    const fadeStart = Math.max(0, totalDuration - AUDIO_FADE_SEC);
    fadeGain.gain.setValueAtTime(1, fadeStart);
    fadeGain.gain.linearRampToValueAtTime(0.0001, totalDuration);
  }

  const totalFrames = Math.max(1, Math.ceil(totalDuration * fps));

  // ─── Pass 1: render audio offline, capturing the AnalyserNode's bands at
  // each frame's exact timestamp along the way — nothing is drawn yet.
  const bandsPerFrame = new Array(totalFrames);
  let rendered = null;
  if (hasAudio) {
    // suspend() must be scheduled *before* the render thread is let loose via
    // resume(), or it free-runs to the end of the buffer before our next JS
    // tick gets a chance to register the following suspend point. So the next
    // suspend is always queued up first, and only then do we resume from the
    // current one.
    const suspendTimeFor = (i) => Math.max(i / fps, 0.0001);
    let pendingSuspend = offlineCtx.suspend(suspendTimeFor(0));
    const renderedBufferPromise = offlineCtx.startRendering();

    for (let i = 0; i < totalFrames; i++) {
      if (shouldAbort && shouldAbort()) throw new DOMException("Export aborted", "AbortError");
      // Waits for the render to reach this frame's timestamp so the
      // analyser reflects that exact instant, then reads it before resuming.
      await pendingSuspend;
      bandsPerFrame[i] = analyzeBands(mixer.analyser, sampleRate);
      if (i + 1 < totalFrames) pendingSuspend = offlineCtx.suspend(suspendTimeFor(i + 1));
      offlineCtx.resume();
      // Audio pre-render is usually much faster than the draw+encode pass
      // below, so it only claims the first slice of the progress bar —
      // otherwise it'd sit at 0% for a while on a long song and look stuck.
      if (onProgress) onProgress((i + 1) / totalFrames * 0.2);
      if (i % 50 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    rendered = await renderedBufferPromise;
  } else {
    for (let i = 0; i < totalFrames; i++) bandsPerFrame[i] = analyzeBands(null, sampleRate);
  }

  // ─── Pass 2: draw + encode each video frame. Audio is hooked up first and
  // its track closed immediately, so the muxer can interleave and flush
  // video frames to the output as they're encoded instead of buffering the
  // entire video in memory while it waits for audio that isn't coming until
  // the very end (see file header).
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

  if (hasAudio) {
    // Fed as-is, no trim-to-exact-length copy: that would mean holding two
    // full-length copies of the whole song's audio in memory at once, which
    // for a long export (many minutes, high loop count) adds up fast. The
    // few seconds of slack past totalDuration are already faded to near
    // silence (AUDIO_FADE_SEC), so leaving them in is inaudible — the track
    // just runs a hair longer than the video, which every player tolerates.
    await audioSource.add(rendered);
    audioSource.close();
    rendered = null;
  }

  for (let i = 0; i < totalFrames; i++) {
    if (shouldAbort && shouldAbort()) {
      await output.cancel();
      throw new DOMException("Export aborted", "AbortError");
    }

    const t = i / fps;
    await drawFrame(ctx, { elapsed: t * 1000, playhead: t, bands: bandsPerFrame[i], mixer, frameIndex: i, totalFrames, totalDuration });
    await videoSource.add(t, 1 / fps);

    if (onProgress) onProgress(0.2 + (i + 1) / totalFrames * 0.8);

    // Yield to the event loop periodically so the UI (progress %) can repaint.
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  await output.finalize();
  return { blob: new Blob([target.buffer], { type: "video/webm" }), totalDuration };
}
