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

  // suspend() must be scheduled *before* the render thread is let loose via
  // resume(), or it free-runs to the end of the buffer before our next JS
  // tick gets a chance to register the following suspend point. So the next
  // suspend is always queued up first, and only then do we resume from the
  // current one.
  const suspendTimeFor = (i) => Math.max(i / fps, 0.0001);
  let pendingSuspend = hasAudio ? offlineCtx.suspend(suspendTimeFor(0)) : null;
  const renderedBufferPromise = hasAudio ? offlineCtx.startRendering() : null;

  for (let i = 0; i < totalFrames; i++) {
    if (shouldAbort && shouldAbort()) {
      await output.cancel();
      throw new DOMException("Export aborted", "AbortError");
    }

    const t = i / fps;
    let bands;
    if (hasAudio) {
      // Waits for the render to reach this frame's timestamp so the
      // analyser reflects that exact instant, then reads it before resuming.
      await pendingSuspend;
      bands = analyzeBands(mixer.analyser, sampleRate);
    } else {
      bands = analyzeBands(null, sampleRate);
    }

    await drawFrame(ctx, { elapsed: t * 1000, playhead: t, bands, mixer, frameIndex: i, totalFrames, totalDuration });
    await videoSource.add(t, 1 / fps);

    if (hasAudio) {
      if (i + 1 < totalFrames) pendingSuspend = offlineCtx.suspend(suspendTimeFor(i + 1));
      offlineCtx.resume();
    }
    if (onProgress) onProgress((i + 1) / totalFrames);

    // Yield to the event loop periodically so the UI (progress %) can repaint.
    if (i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  if (hasAudio) {
    const rendered = await renderedBufferPromise;
    const exactSamples = Math.min(rendered.length, Math.round(totalDuration * sampleRate));
    const trimmed = new AudioBuffer({ length: exactSamples, sampleRate, numberOfChannels: rendered.numberOfChannels });
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      trimmed.copyToChannel(rendered.getChannelData(c).subarray(0, exactSamples), c);
    }
    await audioSource.add(trimmed);
  }

  await output.finalize();
  return { blob: new Blob([target.buffer], { type: "video/webm" }), totalDuration };
}
