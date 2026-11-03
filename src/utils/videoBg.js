/* ═══════════════════════════════════════════════════════════
   VIDEO BACKGROUND CLIPS — file probing + export decode
   ───────────────────────────────────────────────────────────
   The mediabunny-backed half of clip support: opening a clip file, checking
   this browser can decode it, and pulling exact frames out of it for the
   frame-locked export. Kept apart from clipTimeline.js, which needs no
   dependencies at all and runs inside the real-time preview loop.
   ═══════════════════════════════════════════════════════════ */
import { Input, BlobSource, CanvasSink, MP4, QTFF, MATROSKA, WEBM } from "mediabunny";

// Only the container formats a background clip can plausibly arrive in.
// ALL_FORMATS would also pull in every audio-only demuxer mediabunny has
// (MP3, WAVE, OGG, ADTS, FLAC, MPEG-TS, HLS) — dead weight in the bundle for
// files this feature never accepts.
const CLIP_FORMATS = [MP4, QTFF, MATROSKA, WEBM];
import { sampleClipCycle } from "./clipTimeline.js";

/* Reads back what the clip list UI needs to show, and — by opening the file
   exactly the way the export will — fails here, at upload, rather than part
   way through a render. */
export async function probeClip(file) {
  const input = new Input({ source: new BlobSource(file), formats: CLIP_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("ไม่พบแทร็กวิดีโอในไฟล์นี้");
    if (!(await track.canDecode())) {
      throw new Error(`เบราว์เซอร์นี้ถอดรหัส ${track.codec || "โคเดกของไฟล์นี้"} ไม่ได้`);
    }
    const duration = await track.computeDuration();
    let poster = null;
    try {
      const thumbSink = new CanvasSink(track, { width: 160 });
      const shot = await thumbSink.getCanvas(Math.min(0.1, duration / 2));
      if (shot && shot.canvas.toDataURL) poster = shot.canvas.toDataURL("image/jpeg", 0.7);
    } catch (e) {
      // A missing thumbnail is cosmetic — the clip is still usable.
    }
    return {
      duration, poster, codec: track.codec,
      width: track.displayWidth, height: track.displayHeight,
    };
  } finally {
    input.dispose();
  }
}

/* ─── Export: mediabunny sequential decode ───────────────── */

/* Walks one clip forwards through a CanvasSink. Holding the iterator between
   calls is the whole point: consecutive output frames land inside the same
   decode run, so no seek is needed. A timestamp that goes backwards means the
   sequence looped, which is the one case that restarts the run. */
class SequentialClipReader {
  constructor(makeSink) {
    this._makeSink = makeSink;
    this._sink = null;
    this._iter = null;
    this._cur = null;
    this._lastT = -1;
  }

  async canvasAt(t) {
    if (!this._iter || t < this._lastT - 1e-6) {
      await this._endIter();
      if (!this._sink) this._sink = this._makeSink();
      this._iter = this._sink.canvases(Math.max(0, t));
      this._cur = null;
    }
    this._lastT = t;

    // Advance until the held frame's presentation window covers t. The guard
    // stops a bad timestamp from decoding its way through the entire clip.
    let steps = 0;
    while (!this._cur || this._cur.timestamp + Math.max(this._cur.duration, 1e-4) <= t) {
      if (++steps > 600) break;
      const { value, done } = await this._iter.next();
      if (done || !value) break;
      this._cur = value;
    }
    return this._cur;
  }

  async _endIter() {
    if (this._iter && this._iter.return) {
      try { await this._iter.return(); } catch (e) { /* already finished */ }
    }
    this._iter = null;
  }

  async dispose() {
    await this._endIter();
    this._cur = null;
  }
}

/* Opens every clip of one track for export. Frames come out already scaled to
   cover width x height, so the draw path treats them exactly like a
   pre-fitted background image. */
export async function createClipDecoder(clips, { width, height }) {
  const entries = [];
  try {
    for (const c of clips) {
      const input = new Input({ source: new BlobSource(c.file), formats: CLIP_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error(`คลิป "${c.name}" ไม่มีแทร็กวิดีโอ`);
      if (!(await track.canDecode())) {
        throw new Error(`ถอดรหัสคลิป "${c.name}" ไม่ได้ (${track.codec || "โคเดกไม่รองรับ"})`);
      }
      // poolSize 2: only the most recently pulled canvas is ever still being
      // drawn, so recycling two pulls later can't overwrite it.
      const makeSink = () => new CanvasSink(track, { width, height, fit: "cover", poolSize: 2 });
      entries.push({
        input,
        primary: new SequentialClipReader(makeSink),
        // Single clip ⇒ it fades into itself ⇒ two positions in one file at once.
        secondary: clips.length === 1 ? new SequentialClipReader(makeSink) : null,
      });
    }
  } catch (err) {
    for (const e of entries) e.input.dispose();
    throw err;
  }

  return {
    clips,
    async layers(cycle, t) {
      const s = sampleClipCycle(cycle, t);
      const selfFade = !!s.b && s.a.idx === s.b.idx;
      const out = [];

      const aEntry = entries[s.a.idx];
      const a = await (selfFade ? aEntry.secondary : aEntry.primary).canvasAt(s.a.time);
      if (a) out.push({ src: a.canvas, w: a.canvas.width, h: a.canvas.height, alpha: 1 });
      if (s.b) {
        const b = await entries[s.b.idx].primary.canvasAt(s.b.time);
        if (b) out.push({ src: b.canvas, w: b.canvas.width, h: b.canvas.height, alpha: s.mix });
      }
      return out;
    },
    async dispose() {
      for (const e of entries) {
        await e.primary.dispose();
        if (e.secondary) await e.secondary.dispose();
        e.input.dispose();
      }
    },
  };
}
