/* ═══════════════════════════════════════════════════════════
   VIDEO BACKGROUND CLIPS — timeline + live preview
   ───────────────────────────────────────────────────────────
   A track's background can be a still image or a list of video clips. The
   clips play back to back with an equal-length crossfade between each one,
   and the whole sequence loops for as long as the track lasts — including a
   crossfade from the last clip back into the first, so a loop never shows a
   hard cut.

   The timeline math lives here (buildClipCycle / sampleClipCycle) and is
   shared by both render paths, but the two paths read frames completely
   differently, because they run on different clocks:

   - PREVIEW is real-time, inside a requestAnimationFrame loop that must not
     block. So it uses muted <video> elements left playing at rate 1 and only
     nudged back into position when they drift — createClipPreview, below.
     Seeking per frame would be nowhere near fast enough to watch.

   - EXPORT is frame-locked: it draws frame N at exactly N/fps regardless of
     how long that takes, so a <video> is useless — its currentTime only
     advances on a wall clock. That path decodes frames at exact timestamps
     instead, and lives in videoBg.js along with everything else that needs
     mediabunny — this file deliberately has no dependencies, since it runs
     inside the preview's frame loop.
   ═══════════════════════════════════════════════════════════ */

/* Lays the clips out on one loop of the sequence.

   Clip i occupies [starts[i], starts[i] + durs[i]) and overlaps its successor
   by exactly `x`, so starts[i+1] = starts[i] + durs[i] - x. The cycle is
   `cycleDur` long — short of the summed durations by one `x` per clip, the
   last of which is the wrap-around crossfade back into clip 0.

   x is clamped to half the shortest clip: any longer and a clip's fade-in and
   fade-out would overlap each other, which the two-layer sampling below
   can't represent (and which would look like a mess anyway). */
export function buildClipCycle(clips, xfadeSec) {
  const n = clips?.length || 0;
  if (!n) return null;
  const durs = clips.map((c) => Math.max(0.05, c.duration || 0));
  const x = Math.max(0, Math.min(xfadeSec ?? 0, Math.min(...durs) / 2));
  const starts = [0];
  for (let i = 1; i < n; i++) starts.push(starts[i - 1] + durs[i - 1] - x);
  const cycleDur = Math.max(0.05, starts[n - 1] + durs[n - 1] - x);
  return { durs, starts, x, n, cycleDur };
}

/* Which clip(s) are on screen `t` seconds into the track, and where each one
   is scrubbed to. `a` is the outgoing clip, `b` the incoming one drawn over
   it at alpha `mix`; `b` is null whenever a single clip is on screen alone.

   a.idx === b.idx happens when there's only one clip: it crossfades into
   itself, so its tail and its head are both needed at the same instant. Both
   render paths handle that by keeping a second reader on that same file. */
export function sampleClipCycle(cycle, t) {
  const { durs, starts, x, n, cycleDur } = cycle;
  let u = (t || 0) % cycleDur;
  if (u < 0) u += cycleDur;

  let i = n - 1;
  while (i > 0 && starts[i] > u) i--;
  const local = u - starts[i];

  if (x > 0 && local < x) {
    const j = (i - 1 + n) % n; // wraps to the last clip during clip 0's fade-in
    return {
      a: { idx: j, time: durs[j] - x + local },
      b: { idx: i, time: local },
      mix: local / x,
    };
  }
  return { a: { idx: i, time: local }, b: null, mix: 0 };
}

/* ─── Preview: live <video> elements ─────────────────────── */

const DRIFT_SEC = 0.25; // past this, nudge currentTime instead of letting it ride

export function createClipPreview(clips) {
  const mkEl = (url) => {
    const el = document.createElement("video");
    el.src = url;
    el.muted = true;
    el.playsInline = true;
    el.preload = "auto";
    el.loop = false;
    return el;
  };
  const els = clips.map((c) => mkEl(c.url));
  // A lone clip crossfades into itself, so one element can't serve both ends.
  const shadow = clips.length === 1 ? mkEl(clips[0].url) : null;

  const place = (el, time) => {
    if (!el) return null;
    const ready = el.readyState >= 2;
    if (!ready || Math.abs(el.currentTime - time) > DRIFT_SEC) {
      try { el.currentTime = time; } catch (e) { /* not seekable yet */ }
    }
    if (el.paused) el.play().catch(() => { /* autoplay blocked; frame still draws */ });
    return ready ? el : null;
  };

  return {
    clips,
    /* Layers for track-time `t`, back to front. Can come back empty while a
       clip is still loading — the caller just draws black for that frame. */
    layers(cycle, t) {
      const s = sampleClipCycle(cycle, t);
      const selfFade = !!s.b && s.a.idx === s.b.idx;
      const out = [];

      const aEl = place(selfFade ? shadow : els[s.a.idx], s.a.time);
      if (aEl) out.push({ src: aEl, w: aEl.videoWidth, h: aEl.videoHeight, alpha: 1 });
      if (s.b) {
        const bEl = place(els[s.b.idx], s.b.time);
        if (bEl) out.push({ src: bEl, w: bEl.videoWidth, h: bEl.videoHeight, alpha: s.mix });
      }

      // Park every clip that isn't on screen, so the browser isn't decoding
      // the whole list at once.
      for (let i = 0; i < els.length; i++) {
        if (i === s.a.idx || (s.b && i === s.b.idx)) continue;
        if (!els[i].paused) els[i].pause();
      }
      if (shadow && !selfFade && !shadow.paused) shadow.pause();

      return out;
    },
    /* Stop decoding without giving up the loaded files — for when playback
       stops but the clips are still assigned to the track. */
    pause() {
      for (const el of els) el.pause();
      if (shadow) shadow.pause();
    },
    dispose() {
      for (const el of els) { el.pause(); el.removeAttribute("src"); el.load(); }
      if (shadow) { shadow.pause(); shadow.removeAttribute("src"); shadow.load(); }
    },
  };
}

