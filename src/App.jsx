import { useState, useRef, useEffect, useCallback } from "react";
import { analyzeBands } from "./utils/audio.js";
import { detectBPM, createMixer, currentTrack } from "./utils/mixer.js";
import { renderSongTitle } from "./visualizers/songTitle.js";
import { renderBokehSparkle, setBokehConfig } from "./visualizers/bokehSparkle.js";

/* ═══════════════════════════════════════════════════════════
   DOWNLOAD HELPER
   ═══════════════════════════════════════════════════════════ */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.target = "_self"; a.rel = "noopener";
  a.style.display = "none"; document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ═══════════════════════════════════════════════════════════
   BUTTON COMPONENT
   ═══════════════════════════════════════════════════════════ */
const Btn = ({ children, primary, disabled, onClick, sx }) => (
  <button onClick={onClick} disabled={disabled} style={{
    background: primary ? (disabled ? "#1A1814" : "linear-gradient(135deg,#D4AF37,#B8973A)") : "transparent",
    color: primary ? (disabled ? "#6A6050" : "#080604") : "#C8C4BE",
    border: primary ? "none" : "1px solid #2A2520", padding: "12px 32px", borderRadius: 6, fontSize: 15,
    fontFamily: "'Sarabun',sans-serif", fontWeight: primary ? 600 : 400,
    cursor: disabled ? "default" : "pointer", letterSpacing: 0.5, transition: "all 0.3s", ...sx,
  }}>{children}</button>
);

/* ═══════════════════════════════════════════════════════════
   DRAW BACKGROUND IMAGE (cover-fit)
   ═══════════════════════════════════════════════════════════ */
function drawBg(ctx, cw, ch, img) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  if (!img) return;
  const scale = Math.max(cw / img.width, ch / img.height);
  const sw = img.width * scale, sh = img.height * scale;
  ctx.drawImage(img, (cw - sw) / 2, (ch - sh) / 2, sw, sh);
}

/* ═══════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════ */
export default function App() {
  const [tracks, setTracks] = useState([]); // [{name, buffer, bpm, fileName, bgImage}]
  const [crossfadeSec, setCrossfadeSec] = useState(10);
  const [decoding, setDecoding] = useState(false);
  const [titleMode, setTitleMode] = useState("dynamic");
  const [audioName, setAudioName] = useState("");
  const [songTitle, setSongTitle] = useState("");
  const [songTitle2, setSongTitle2] = useState("");
  const [loops, setLoops] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProg, setExportProg] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadName, setDownloadName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [resolution, setResolution] = useState("1080p");
  const [step, setStep] = useState(1);
  const [showTitle, setShowTitle] = useState(true);
  const [bandLevels, setBandLevels] = useState(null);
  const [titlePos, setTitlePos] = useState("bottom-center");
  const [titleFontSize, setTitleFontSize] = useState(50);
  const [titleFontSize2, setTitleFontSize2] = useState(30);
  const [endLogo, setEndLogo] = useState(null);
  const [bokehEnabled, setBokehEnabled] = useState(true);
  const [bokehQuantity, setBokehQuantity] = useState(1.0);
  const [bokehSizeRange, setBokehSizeRange] = useState(1.0);
  const [bokehShape, setBokehShape] = useState("circle");
  const [bokehOpacity, setBokehOpacity] = useState(1.0);
  const [bokehDirection, setBokehDirection] = useState("down");

  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const audioCtxRef = useRef(null);
  const sourceRef = useRef(null);
  const mixerRef = useRef(null);
  const liveAnalyserRef = useRef(null);
  const cycleTimerRef = useRef(null);
  const tracksRef = useRef([]);
  const fileRef = useRef(null);
  const startTRef = useRef(0);
  const exportTimerRef = useRef(null);
  const downloadBlobRef = useRef(null);

  const RES = { "720p": [1280, 720], "1080p": [1920, 1080], "1440p": [2560, 1440], "4K": [3840, 2160] };
  const BITRATE = { "720p": 8_000_000, "1080p": 20_000_000, "1440p": 40_000_000, "4K": 80_000_000 };

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  useEffect(() => {
    setBokehConfig({ quantity: bokehQuantity, sizeRange: bokehSizeRange, shape: bokehShape, opacity: bokehOpacity, direction: bokehDirection });
  }, [bokehQuantity, bokehSizeRange, bokehShape, bokehOpacity, bokehDirection]);

  const totalPlaylistDuration = useCallback(() => {
    if (!tracks.length) return 0;
    const sum = tracks.reduce((s, t) => s + (t.buffer ? t.buffer.duration : 0), 0);
    return Math.max(0, sum - crossfadeSec * (tracks.length - 1));
  }, [tracks, crossfadeSec]);

  const stopPreviewOnly = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current); animRef.current = null;
    if (exportTimerRef.current) { cancelAnimationFrame(exportTimerRef.current); clearTimeout(exportTimerRef.current); } exportTimerRef.current = null;
    if (cycleTimerRef.current) { clearTimeout(cycleTimerRef.current); cycleTimerRef.current = null; }
    if (mixerRef.current) { try { mixerRef.current.stop() } catch (e) { } mixerRef.current = null; }
    if (sourceRef.current) { try { sourceRef.current.stop() } catch (e) { } sourceRef.current = null; }
    liveAnalyserRef.current = null;
    setPlaying(false); setBandLevels(null);
  }, []);

  const stopAll = useCallback(() => {
    stopPreviewOnly();
    setExporting(false);
  }, [stopPreviewOnly]);

  // Get background image for given playhead position
  const getBgForPlayhead = useCallback((mixer, playhead) => {
    const t = tracksRef.current;
    if (!t.length) return null;
    if (!mixer) return t[0]?.bgImage || null;
    const cur = currentTrack(mixer.schedule, playhead);
    if (!cur) return t[0]?.bgImage || null;
    const idx = t.findIndex(tk => tk.name === cur.name);
    return (idx >= 0 ? t[idx]?.bgImage : null) || null;
  }, []);

  const startPreview = useCallback(() => {
    stopAll();
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const [cw, ch] = RES[resolution]; canvas.width = cw; canvas.height = ch;
    let sampleRate = 44100;
    const readyTracks = tracksRef.current.filter(t => t.buffer);

    const scheduleCycle = (startTime) => {
      const actx = audioCtxRef.current;
      const m = createMixer(actx, readyTracks, { crossfade: crossfadeSec, startTime });
      mixerRef.current = m;
      liveAnalyserRef.current = m.analyser;
      const nextStartAbs = m.mixStart + m.totalDuration - crossfadeSec;
      const delayMs = Math.max(0, (nextStartAbs - actx.currentTime) * 1000);
      cycleTimerRef.current = setTimeout(() => {
        if (animRef.current) scheduleCycle(nextStartAbs);
      }, delayMs);
    };

    if (readyTracks.length) {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const actx = audioCtxRef.current; sampleRate = actx.sampleRate;
      actx.resume && actx.resume();
      scheduleCycle();
    }

    startTRef.current = 0; let fc = 0;
    const loop = (ts) => {
      if (!startTRef.current) startTRef.current = ts;
      const elapsed = ts - startTRef.current;
      const analyser = liveAnalyserRef.current;
      const bands = analyzeBands(analyser, sampleRate);
      if (fc % 3 === 0) setBandLevels(bands);

      // Background image
      const mixer = mixerRef.current;
      let playhead = 0;
      if (mixer && audioCtxRef.current) playhead = audioCtxRef.current.currentTime - mixer.mixStart;
      const bgImg = getBgForPlayhead(mixer, playhead);
      drawBg(ctx, cw, ch, bgImg);

      // Bokeh
      if (bokehEnabled) renderBokehSparkle(ctx, cw, ch, elapsed, bands);

      // Title
      let line1 = songTitle || audioName;
      if (titleMode === "dynamic" && mixer) {
        const cur = currentTrack(mixer.schedule, playhead);
        if (cur) line1 = cur.name || line1;
      }
      if (showTitle) renderSongTitle(ctx, cw, ch, line1, songTitle2, bands, elapsed, titlePos, titleFontSize, titleFontSize2);

      fc++; animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop); setPlaying(true);
  }, [resolution, tracks, crossfadeSec, titleMode, audioName, songTitle, songTitle2, showTitle, titlePos, titleFontSize, titleFontSize2, bokehEnabled, getBgForPlayhead, stopAll]);

  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(f =>
      f && (f.type.startsWith("audio/") || /\.(mp3|wav|flac|ogg|aac|m4a|wma|opus)$/i.test(f.name))
    );
    if (!files.length) return;
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    setDecoding(true);
    for (const file of files) {
      try {
        const buffer = await audioCtxRef.current.decodeAudioData(await file.arrayBuffer());
        const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        const entry = { name: cleanName, buffer, bpm: 0, fileName: file.name, bgImage: null };
        setTracks(prev => {
          const next = [...prev, entry];
          if (next.length === 1) { setAudioName(file.name); setSongTitle(cleanName); }
          return next;
        });
        detectBPM(buffer).then(bpm => {
          setTracks(prev => prev.map(t => t === entry ? { ...t, bpm } : t));
        });
      } catch (e) {
        console.error("Decode failed", file.name, e);
      }
    }
    setDecoding(false);
  }, []);

  const removeTrack = useCallback((idx) => {
    setTracks(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const moveTrack = useCallback((idx, dir) => {
    setTracks(prev => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev]; [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }, []);

  const updateTrackName = useCallback((idx, val) => {
    setTracks(prev => prev.map((t, i) => i === idx ? { ...t, name: val } : t));
  }, []);

  const setTrackBg = useCallback((idx, file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const img = new Image();
    img.onload = () => setTracks(prev => prev.map((t, i) => i === idx ? { ...t, bgImage: img } : t));
    img.src = URL.createObjectURL(file);
  }, []);

  const handleLogoFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const img = new Image();
    img.onload = () => setEndLogo(img);
    img.src = URL.createObjectURL(file);
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true); setExportProg(0); stopPreviewOnly();
    let rec = null;
    try {
      const [cw, ch] = RES[resolution];
      const off = document.createElement("canvas");
      off.width = cw; off.height = ch;
      const octx = off.getContext("2d");
      const readyTracks = tracks.filter(t => t.buffer);
      const singleLen = readyTracks.length
        ? readyTracks.reduce((s, t) => s + t.buffer.duration, 0) - crossfadeSec * (readyTracks.length - 1)
        : 60;
      const totalDur = singleLen * loops;
      const stream = off.captureStream(30);
      let analyser = null, sampleRate = 44100;
      let hasAudio = false, exportGain = null, mixer = null;

      if (readyTracks.length) {
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const actx = audioCtxRef.current;
        await actx.resume();
        sampleRate = actx.sampleRate;
        exportGain = actx.createGain(); exportGain.gain.value = 1;
        const dest = actx.createMediaStreamDestination();
        const repeated = [];
        for (let r = 0; r < loops; r++) repeated.push(...readyTracks);
        mixer = createMixer(actx, repeated, { crossfade: crossfadeSec, connectDestination: false, destinations: [exportGain] });
        mixerRef.current = mixer;
        analyser = mixer.analyser;
        exportGain.connect(dest);
        exportGain.connect(actx.destination);
        dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
        hasAudio = stream.getAudioTracks().length > 0;
      }

      const effectiveTotal = mixer ? mixer.totalDuration : totalDur;
      const mimeType = hasAudio ? "video/webm;codecs=vp9,opus" : "video/webm;codecs=vp9";
      rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: BITRATE[resolution] ?? 30_000_000 });
      const chunks = []; rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) };
      const done = new Promise(r => { rec.onstop = r }); rec.start(100);

      const visCanvas = canvasRef.current;
      const visCtx = visCanvas ? visCanvas.getContext("2d") : null;
      if (visCanvas) { visCanvas.width = cw; visCanvas.height = ch; }
      const exportStartTime = Date.now();
      const totalMs = effectiveTotal * 1000;
      let lastProgUpdate = 0;

      await new Promise((resolveRender) => {
        const render = () => {
          const elapsed = Date.now() - exportStartTime;
          if (elapsed >= totalMs) {
            try { rec.stop(); } catch (e) { }
            if (sourceRef.current) { try { sourceRef.current.stop() } catch (e) { } sourceRef.current = null; }
            resolveRender(); return;
          }
          const bands = analyzeBands(analyser, sampleRate);
          let playhead = 0;
          if (mixer && audioCtxRef.current) playhead = audioCtxRef.current.currentTime - mixer.mixStart;
          const bgImg = getBgForPlayhead(mixer, playhead);
          drawBg(octx, cw, ch, bgImg);

          if (bokehEnabled) renderBokehSparkle(octx, cw, ch, elapsed, bands);

          let expLine1 = songTitle || audioName;
          if (titleMode === "dynamic" && mixer) {
            const cur = currentTrack(mixer.schedule, playhead);
            if (cur) expLine1 = cur.name || expLine1;
          }
          if (showTitle) renderSongTitle(octx, cw, ch, expLine1, songTitle2, bands, elapsed, titlePos, titleFontSize, titleFontSize2);

          const fadeMs = 15000;
          const remaining = totalMs - elapsed;
          if (remaining < fadeMs) {
            const fadeAlpha = 1 - (remaining / fadeMs);
            octx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
            octx.fillRect(0, 0, cw, ch);
            if (exportGain) exportGain.gain.value = 1 - fadeAlpha;
            if (endLogo && remaining < fadeMs * 0.67) {
              const logoFadeIn = 1 - (remaining / (fadeMs * 0.67));
              const logoAlpha = Math.min(1, logoFadeIn * 2) * (1 - Math.max(0, logoFadeIn - 0.7) / 0.3);
              const maxLogoH = ch * 0.2;
              const logoScale = Math.min(maxLogoH / endLogo.height, (cw * 0.3) / endLogo.width);
              const logoW = endLogo.width * logoScale, logoH = endLogo.height * logoScale;
              octx.globalAlpha = logoAlpha * 0.9;
              octx.drawImage(endLogo, (cw - logoW) / 2, (ch - logoH) / 2, logoW, logoH);
              octx.globalAlpha = 1;
            }
          }
          if (visCtx) visCtx.drawImage(off, 0, 0);
          if (elapsed - lastProgUpdate > 500) {
            lastProgUpdate = elapsed;
            setExportProg(Math.min(100, Math.round((elapsed / totalMs) * 100)));
          }
          exportTimerRef.current = requestAnimationFrame(render);
        };
        exportTimerRef.current = requestAnimationFrame(render);
      });

      await done;
      if (chunks.length === 0) { console.error("No data recorded!"); return; }
      const blob = new Blob(chunks, { type: "video/webm" });
      const fname = `${(songTitle || "storybook").replace(/\s+/g, "-")}.webm`;
      downloadBlobRef.current = { blob, name: fname };
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url); setDownloadName(fname);
    } catch (err) {
      console.error("Export error:", err);
      if (rec && rec.state === "recording") try { rec.stop(); } catch (e) { }
      if (sourceRef.current) { try { sourceRef.current.stop() } catch (e) { } sourceRef.current = null; }
      if (mixerRef.current) { try { mixerRef.current.stop() } catch (e) { } mixerRef.current = null; }
    } finally {
      setExporting(false); exportTimerRef.current = null;
    }
  }, [loops, resolution, tracks, crossfadeSec, titleMode, audioName, songTitle, songTitle2, showTitle, titlePos, titleFontSize, titleFontSize2, bokehEnabled, endLogo, getBgForPlayhead, stopPreviewOnly]);

  useEffect(() => () => stopAll(), [stopAll]);

  useEffect(() => {
    if (step === 2 && canvasRef.current) {
      const [cw, ch] = RES[resolution];
      canvasRef.current.width = cw; canvasRef.current.height = ch;
      const ctx = canvasRef.current.getContext("2d");
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cw, ch);
    }
  }, [step, resolution]);

  const bandNames = ["Sub", "Bass", "Low", "Mid", "Hi", "Pres", "Air"];
  const bandKeys = ["subBass", "bass", "lowMid", "mid", "highMid", "presence", "brilliance"];
  const gold = (a = 1) => `rgba(212,175,55,${a})`;

  return (
    <div style={{ minHeight: "100vh", background: "#030201", color: "#F0EDE8", fontFamily: "'Cormorant Garamond','Sarabun',Georgia,serif", overflowY: "auto" }}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300&family=Sarabun:wght@200;300;400;600&display=swap" rel="stylesheet" />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 1100, margin: "0 auto", padding: "36px 20px" }}>

        {/* HEADER */}
        <header style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ fontSize: 16, letterSpacing: 10, textTransform: "uppercase", color: gold(0.4), marginBottom: 14, fontFamily: "'Sarabun'", fontWeight: 200 }}>◈ &nbsp; Storybook Creator &nbsp; ◈</div>
          <h1 style={{ fontSize: 38, fontWeight: 300, margin: 0, letterSpacing: 3, background: "linear-gradient(135deg,#D4AF37 0%,#F5E6A3 40%,#D4AF37 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Storytailing</h1>
          <p style={{ fontSize: 17, fontWeight: 200, color: "#B0AAA2", marginTop: 10, fontFamily: "'Sarabun'" }}>เพิ่มเพลงและรูปภาพพื้นหลังสำหรับแต่ละบท — สร้างหนังสือนิทานมีเสียง</p>
        </header>

        {/* STEP INDICATOR */}
        <div style={{ display: "flex", justifyContent: "center", gap: 32, marginBottom: 44 }}>
          {[{ n: 1, l: "เพลงและรูปภาพ" }, { n: 2, l: "Preview & Export" }].map(st => (
            <div key={st.n} onClick={() => { if (st.n === 1 || tracks.length) setStep(st.n); }}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", opacity: step >= st.n ? 1 : 0.25, transition: "all 0.4s" }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", border: step === st.n ? "1px solid " + gold(0.6) : "1px solid #1E1C18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontFamily: "'Sarabun'", background: step === st.n ? "rgba(212,175,55,0.06)" : "transparent", color: step === st.n ? gold(0.8) : "#4A4030" }}>{st.n}</div>
              <span style={{ fontSize: 16, fontFamily: "'Sarabun'", fontWeight: 300, color: step === st.n ? gold(0.7) : "#4A4030" }}>{st.l}</span>
            </div>
          ))}
        </div>

        {/* ═══ STEP 1: AUDIO & IMAGES ═══ */}
        {step === 1 && (
          <div style={{ maxWidth: 640, margin: "0 auto" }}>

            {/* Audio drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              style={{ border: dragOver ? "1px solid " + gold(0.6) : tracks.length ? "1px solid #1E1C18" : "1px dashed #1A1814", borderRadius: 12, padding: tracks.length ? "24px 22px" : "48px 28px", textAlign: "center", cursor: "pointer", background: dragOver ? "rgba(212,175,55,0.03)" : "rgba(8,6,4,0.7)", transition: "all 0.4s" }}>
              <input ref={fileRef} type="file" multiple accept=".mp3,.wav,.flac,.ogg,.aac,.m4a,.wma,.opus,audio/*" style={{ display: "none" }} onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
              <div style={{ fontSize: 28, color: gold(0.6), marginBottom: 6 }}>♪</div>
              <div style={{ fontSize: 16, color: "#9A948C" }}>{tracks.length ? "+ เพิ่มเพลง (เลือกได้หลายไฟล์)" : "ลากไฟล์เพลงมาวางที่นี่ (เลือกได้หลายไฟล์)"}</div>
              <div style={{ fontSize: 14, color: "#7A746C", fontFamily: "'Sarabun'", marginTop: 6 }}>MP3 · WAV · FLAC · OGG · AAC {decoding ? " · กำลังโหลด..." : ""}</div>
            </div>

            {/* Track list */}
            {tracks.length > 0 && (
              <div style={{ marginTop: 16, background: "rgba(8,6,4,0.6)", border: "1px solid #1A1814", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 13, color: gold(0.5), fontFamily: "'Sarabun'", fontWeight: 300, marginBottom: 10, letterSpacing: 1, textTransform: "uppercase" }}>
                  Playlist ({tracks.length} tracks · ≈ {Math.floor(totalPlaylistDuration() / 60)}:{String(Math.floor(totalPlaylistDuration() % 60)).padStart(2, "0")})
                </div>
                {tracks.map((t, i) => (
                  <div key={i} style={{ padding: "14px 6px", borderBottom: i < tracks.length - 1 ? "1px solid #14120F" : "none" }}>
                    {/* Row 1: controls + name */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 13, color: gold(0.5), width: 22, textAlign: "center", fontFamily: "'Sarabun'", flexShrink: 0 }}>{i + 1}</div>
                      <input
                        value={t.name}
                        onChange={e => updateTrackName(i, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", borderBottom: "1px solid #1A1814", color: "#F0EDE8", fontSize: 15, fontFamily: "'Sarabun'", fontWeight: 400, outline: "none", padding: "2px 4px" }}
                        onFocus={e => { e.stopPropagation(); e.target.style.borderBottomColor = gold(0.4); }}
                        onBlur={e => e.target.style.borderBottomColor = "#1A1814"}
                      />
                      <button onClick={e => { e.stopPropagation(); moveTrack(i, -1); }} disabled={i === 0} style={{ background: "none", border: "none", color: i === 0 ? "#3A342A" : gold(0.6), cursor: i === 0 ? "default" : "pointer", fontSize: 14, padding: "2px 5px" }}>▲</button>
                      <button onClick={e => { e.stopPropagation(); moveTrack(i, 1); }} disabled={i === tracks.length - 1} style={{ background: "none", border: "none", color: i === tracks.length - 1 ? "#3A342A" : gold(0.6), cursor: i === tracks.length - 1 ? "default" : "pointer", fontSize: 14, padding: "2px 5px" }}>▼</button>
                      <button onClick={e => { e.stopPropagation(); removeTrack(i); }} style={{ background: "none", border: "none", color: "#8A5A5A", cursor: "pointer", fontSize: 14, padding: "2px 6px" }}>✕</button>
                    </div>

                    {/* Row 2: duration info */}
                    <div style={{ fontSize: 11, color: "#7A746C", fontFamily: "'Sarabun'", marginTop: 4, paddingLeft: 30 }}>
                      {Math.floor(t.buffer.duration / 60)}:{String(Math.floor(t.buffer.duration % 60)).padStart(2, "0")}
                      {" · "}{t.buffer.numberOfChannels}ch · {Math.round(t.buffer.sampleRate / 1000)}kHz
                      {t.bpm ? ` · ${t.bpm} BPM` : " · BPM …"}
                    </div>

                    {/* Row 3: background image */}
                    <div style={{ marginTop: 10, paddingLeft: 30, display: "flex", alignItems: "center", gap: 10 }}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
                          inp.onchange = ev => ev.target.files[0] && setTrackBg(i, ev.target.files[0]);
                          inp.click();
                        }}
                        style={{ background: "rgba(8,6,4,0.8)", border: "1px solid " + (t.bgImage ? gold(0.3) : "#1E1C18"), color: t.bgImage ? gold(0.7) : "#9A948C", padding: "5px 14px", borderRadius: 6, fontSize: 13, fontFamily: "'Sarabun'", cursor: "pointer", flexShrink: 0 }}>
                        {t.bgImage ? "🖼 เปลี่ยนรูป" : "+ เพิ่มรูปพื้นหลัง"}
                      </button>
                      {t.bgImage && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <img src={t.bgImage.src} alt="bg" style={{ height: 36, width: 64, objectFit: "cover", borderRadius: 4, border: "1px solid " + gold(0.3) }} />
                          <button onClick={e => { e.stopPropagation(); setTracks(prev => prev.map((tk, j) => j === i ? { ...tk, bgImage: null } : tk)); }}
                            style={{ background: "none", border: "none", color: "#6A6050", cursor: "pointer", fontSize: 13 }}>✕</button>
                        </div>
                      )}
                      {!t.bgImage && (
                        <span style={{ fontSize: 12, color: "#5A5448", fontFamily: "'Sarabun'" }}>ไม่มีรูป — พื้นหลังดำ</span>
                      )}
                    </div>
                  </div>
                ))}

                {/* Crossfade */}
                {tracks.length > 1 && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #14120F" }}>
                    <label style={{ fontSize: 13, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>
                      Crossfade ({crossfadeSec}s) · beat-match + EQ sweep
                    </label>
                    <input type="range" min={2} max={20} step={1} value={crossfadeSec} onChange={e => setCrossfadeSec(Number(e.target.value))} style={{ width: "100%", accentColor: "#D4AF37", cursor: "pointer" }} />
                  </div>
                )}
              </div>
            )}

            {/* Title settings */}
            <div style={{ marginTop: 24 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div onClick={() => setShowTitle(!showTitle)} style={{ width: 18, height: 18, borderRadius: 3, border: "1px solid " + (showTitle ? gold(0.5) : "#1E1C18"), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: showTitle ? "rgba(212,175,55,0.1)" : "transparent", fontSize: 13, color: gold(0.7) }}>{showTitle ? "✓" : ""}</div>
                  <span style={{ fontSize: 14, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200 }}>แสดงชื่อเพลงบนวิดีโอ</span>
                </div>
                {showTitle && (
                  <div style={{ display: "flex", gap: 4 }}>
                    {[["dynamic", "Dynamic"], ["fixed", "Fixed"]].map(([mode, label]) => (
                      <button key={mode} onClick={() => setTitleMode(mode)} style={{ padding: "5px 14px", borderRadius: 6, fontSize: 13, fontFamily: "'Sarabun'", cursor: "pointer", border: titleMode === mode ? "1px solid " + gold(0.5) : "1px solid #1E1C18", background: titleMode === mode ? "rgba(212,175,55,0.08)" : "rgba(8,6,4,0.8)", color: titleMode === mode ? gold(0.8) : "#5A5448", transition: "all 0.2s" }}>{label}</button>
                    ))}
                  </div>
                )}
              </div>

              {showTitle && titleMode === "dynamic" && (
                <div style={{ background: "rgba(212,175,55,0.03)", border: "1px solid #1A1814", borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: gold(0.5), fontFamily: "'Sarabun'", fontWeight: 300, marginBottom: 6 }}>บรรทัดที่ 1 — ใช้ชื่อเพลงจาก playlist อัตโนมัติ</div>
                  <label style={{ fontSize: 13, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>บรรทัดที่ 2 — ข้อความคงที่ (ไม่บังคับ)</label>
                  <input value={songTitle2} onChange={e => setSongTitle2(e.target.value)} placeholder="ศิลปิน / คำโปรย"
                    style={{ width: "100%", boxSizing: "border-box", background: "rgba(8,6,4,0.8)", border: "1px solid #1A1814", borderRadius: 8, padding: "10px 14px", color: "#F0EDE8", fontSize: 15, fontFamily: "'Sarabun'", outline: "none" }}
                    onFocus={e => e.target.style.borderColor = gold(0.3)} onBlur={e => e.target.style.borderColor = "#1A1814"} />
                </div>
              )}

              {showTitle && titleMode === "fixed" && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 14, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>บรรทัดที่ 1</label>
                  <input value={songTitle} onChange={e => setSongTitle(e.target.value)} placeholder="ชื่อเพลง"
                    style={{ width: "100%", boxSizing: "border-box", background: "rgba(8,6,4,0.8)", border: "1px solid #1A1814", borderRadius: 8, padding: "12px 16px", color: "#F0EDE8", fontSize: 17, fontFamily: "'Sarabun'", outline: "none" }}
                    onFocus={e => e.target.style.borderColor = gold(0.3)} onBlur={e => e.target.style.borderColor = "#1A1814"} />
                  <label style={{ fontSize: 14, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6, marginTop: 12 }}>บรรทัดที่ 2 (ไม่บังคับ)</label>
                  <input value={songTitle2} onChange={e => setSongTitle2(e.target.value)} placeholder="ศิลปิน / คำโปรย"
                    style={{ width: "100%", boxSizing: "border-box", background: "rgba(8,6,4,0.8)", border: "1px solid #1A1814", borderRadius: 8, padding: "12px 16px", color: "#F0EDE8", fontSize: 17, fontFamily: "'Sarabun'", outline: "none" }}
                    onFocus={e => e.target.style.borderColor = gold(0.3)} onBlur={e => e.target.style.borderColor = "#1A1814"} />
                </div>
              )}

              {showTitle && (
                <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                  <div>
                    <label style={{ fontSize: 14, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>ตำแหน่ง</label>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 3, width: 90 }}>
                      {[["top-left", "↖"], ["top-center", "↑"], ["top-right", "↗"], ["middle-left", "←"], ["middle-center", "•"], ["middle-right", "→"], ["bottom-left", "↙"], ["bottom-center", "↓"], ["bottom-right", "↘"]].map(([pos, icon]) => (
                        <div key={pos} onClick={() => setTitlePos(pos)} style={{ width: 28, height: 28, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 13, transition: "all 0.2s", border: titlePos === pos ? "1px solid " + gold(0.5) : "1px solid #1A1814", background: titlePos === pos ? "rgba(212,175,55,0.1)" : "rgba(8,6,4,0.6)", color: titlePos === pos ? gold(0.8) : "#9A948C" }}>{icon}</div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 14, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>ขนาดบรรทัด 1 ({titleFontSize}%)</label>
                    <input type="range" min={10} max={90} value={titleFontSize} onChange={e => setTitleFontSize(Number(e.target.value))} style={{ width: "100%", accentColor: "#D4AF37", cursor: "pointer" }} />
                    <label style={{ fontSize: 14, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6, marginTop: 10 }}>ขนาดบรรทัด 2 ({titleFontSize2}%)</label>
                    <input type="range" min={10} max={90} value={titleFontSize2} onChange={e => setTitleFontSize2(Number(e.target.value))} style={{ width: "100%", accentColor: "#D4AF37", cursor: "pointer" }} />
                  </div>
                </div>
              )}
            </div>

            {/* Loops + Resolution */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 24 }}>
              <div>
                <label style={{ fontSize: 17, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>จำนวน Loop</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={() => setLoops(Math.max(1, loops - 1))} style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid #1E1C18", background: "rgba(8,6,4,0.8)", color: gold(0.6), fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                  <span style={{ fontSize: 20, fontWeight: 300, color: gold(0.7), minWidth: 32, textAlign: "center" }}>{loops}</span>
                  <button onClick={() => setLoops(Math.min(99, loops + 1))} style={{ width: 32, height: 32, borderRadius: 6, border: "1px solid #1E1C18", background: "rgba(8,6,4,0.8)", color: gold(0.6), fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>
                {tracks.length > 0 && <div style={{ fontSize: 16, color: "#8A8478", fontFamily: "'Sarabun'", marginTop: 4 }}>≈ {Math.floor(totalPlaylistDuration() * loops / 60)} min</div>}
              </div>
              <div>
                <label style={{ fontSize: 17, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>Resolution</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {["720p", "1080p", "1440p", "4K"].map(r => (
                    <button key={r} onClick={() => setResolution(r)} style={{ padding: "7px 14px", borderRadius: 6, fontSize: 16, fontFamily: "'Sarabun'", cursor: "pointer", border: resolution === r ? "1px solid " + gold(0.4) : "1px solid #1E1C18", background: resolution === r ? "rgba(212,175,55,0.06)" : "rgba(8,6,4,0.8)", color: resolution === r ? gold(0.7) : "#4A4030", transition: "all 0.3s" }}>{r}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* End logo */}
            <div style={{ marginTop: 20 }}>
              <label style={{ fontSize: 14, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>End Credit Logo (ไม่บังคับ — แสดง 15 วินาทีสุดท้าย)</label>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button onClick={() => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.onchange = e => e.target.files[0] && handleLogoFile(e.target.files[0]); inp.click(); }}
                  style={{ background: "rgba(8,6,4,0.8)", border: "1px solid #1E1C18", color: "#9A948C", padding: "8px 20px", borderRadius: 6, fontSize: 14, fontFamily: "'Sarabun'", cursor: "pointer" }}>
                  {endLogo ? "เปลี่ยน Logo" : "เลือกไฟล์รูป"}
                </button>
                {endLogo && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <img src={endLogo.src} alt="logo" style={{ height: 32, borderRadius: 4, border: "1px solid #1E1C18" }} />
                    <button onClick={() => setEndLogo(null)} style={{ background: "none", border: "none", color: "#6A6050", cursor: "pointer", fontSize: 13 }}>✕</button>
                  </div>
                )}
              </div>
            </div>

            {/* Bokeh Sparkle Settings */}
            <div style={{ marginTop: 24, background: "rgba(8,6,4,0.6)", border: "1px solid #1A1814", borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div onClick={() => setBokehEnabled(!bokehEnabled)} style={{ width: 18, height: 18, borderRadius: 3, border: "1px solid " + (bokehEnabled ? gold(0.5) : "#1E1C18"), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: bokehEnabled ? "rgba(212,175,55,0.1)" : "transparent", fontSize: 13, color: gold(0.7) }}>{bokehEnabled ? "✓" : ""}</div>
                  <span style={{ fontSize: 15, color: gold(0.6), fontFamily: "'Sarabun'", fontWeight: 300, letterSpacing: 1 }}>Bokeh Sparkle</span>
                </div>
                <span style={{ fontSize: 12, color: "#5A5448", fontFamily: "'Sarabun'", fontWeight: 200 }}>ละอองโบเก้ระยิบระยับ</span>
              </div>

              {bokehEnabled && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {/* Shape selector */}
                  <div>
                    <label style={{ fontSize: 13, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 8 }}>รูปทรง (Shape)</label>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 4 }}>
                      {[
                        ["circle", "วงกลม", "●"],
                        ["hexagon", "หกเหลี่ยม", "⬡"],
                        ["snowflake", "เกล็ดหิมะ", "❄"],
                        ["raindrop", "หยดฝน", "💧"],
                      ].map(([val, label, icon]) => (
                        <button key={val} onClick={() => setBokehShape(val)} style={{
                          padding: "6px 8px", borderRadius: 6, fontSize: 12, fontFamily: "'Sarabun'", cursor: "pointer",
                          border: bokehShape === val ? "1px solid " + gold(0.5) : "1px solid #1E1C18",
                          background: bokehShape === val ? "rgba(212,175,55,0.08)" : "rgba(8,6,4,0.8)",
                          color: bokehShape === val ? gold(0.8) : "#5A5448", transition: "all 0.2s",
                          display: "flex", alignItems: "center", gap: 4, justifyContent: "center",
                        }}>
                          <span style={{ fontSize: 14 }}>{icon}</span> {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quantity & Size sliders */}
                  <div>
                    <label style={{ fontSize: 13, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6 }}>
                      ปริมาณ ({Math.round(bokehQuantity * 100)}%)
                    </label>
                    <input type="range" min={10} max={300} value={Math.round(bokehQuantity * 100)}
                      onChange={e => setBokehQuantity(Number(e.target.value) / 100)}
                      style={{ width: "100%", accentColor: "#D4AF37", cursor: "pointer" }} />

                    <label style={{ fontSize: 13, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6, marginTop: 10 }}>
                      ขนาดสุ่ม ({Math.round(bokehSizeRange * 100)}%)
                    </label>
                    <input type="range" min={30} max={300} value={Math.round(bokehSizeRange * 100)}
                      onChange={e => setBokehSizeRange(Number(e.target.value) / 100)}
                      style={{ width: "100%", accentColor: "#D4AF37", cursor: "pointer" }} />

                    <label style={{ fontSize: 13, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6, marginTop: 10 }}>
                      ความเข้ม ({Math.round(bokehOpacity * 100)}%)
                    </label>
                    <input type="range" min={5} max={300} value={Math.round(bokehOpacity * 100)}
                      onChange={e => setBokehOpacity(Number(e.target.value) / 100)}
                      style={{ width: "100%", accentColor: "#D4AF37", cursor: "pointer" }} />

                    <label style={{ fontSize: 13, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, display: "block", marginBottom: 6, marginTop: 10 }}>ทิศทาง</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[
                        ["down", "↓ ตก"],
                        ["up", "↑ ลอย"],
                        ["still", "• นิ่ง"],
                      ].map(([val, label]) => (
                        <button key={val} onClick={() => setBokehDirection(val)} style={{
                          flex: 1, padding: "5px 6px", borderRadius: 6, fontSize: 12, fontFamily: "'Sarabun'", cursor: "pointer",
                          border: bokehDirection === val ? "1px solid " + gold(0.5) : "1px solid #1E1C18",
                          background: bokehDirection === val ? "rgba(212,175,55,0.08)" : "rgba(8,6,4,0.8)",
                          color: bokehDirection === val ? gold(0.8) : "#5A5448", transition: "all 0.2s",
                        }}>{label}</button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 36 }}>
              <Btn primary disabled={!tracks.length} onClick={() => tracks.length && setStep(2)}>Preview & Export →</Btn>
            </div>
          </div>
        )}

        {/* ═══ STEP 2: PREVIEW & EXPORT ═══ */}
        {step === 2 && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 17, color: gold(0.7), fontFamily: "'Sarabun'", fontWeight: 300 }}>📖 {tracks.length} บท</span>
              {songTitle && <span style={{ fontSize: 17, color: "#8A8478", fontFamily: "'Sarabun'", fontWeight: 200 }}> · {songTitle}</span>}
              <span style={{ fontSize: 16, color: "#7A746C", fontFamily: "'Sarabun'", fontWeight: 200 }}> · {loops}× · {resolution}</span>
            </div>

            <div style={{ position: "relative", border: "1px solid #0E0D0B", borderRadius: 10, overflow: "hidden", background: "#000", maxWidth: 880, margin: "0 auto" }}>
              <canvas ref={canvasRef} style={{ width: "100%", height: "auto", display: "block" }} />
              {!playing && !exporting && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}>
                  <div onClick={startPreview} style={{ width: 64, height: 64, borderRadius: "50%", border: "1px solid " + gold(0.3), display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "rgba(212,175,55,0.05)", transition: "all 0.3s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(212,175,55,0.12)"; e.currentTarget.style.borderColor = gold(0.6); }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(212,175,55,0.05)"; e.currentTarget.style.borderColor = gold(0.3); }}>
                    <span style={{ fontSize: 22, color: gold(0.7), marginLeft: 3 }}>▶</span>
                  </div>
                </div>
              )}
            </div>

            {playing && bandLevels && (
              <div style={{ maxWidth: 880, margin: "12px auto 0", display: "flex", justifyContent: "center", gap: 6, alignItems: "flex-end" }}>
                {bandKeys.map((key, i) => {
                  const val = bandLevels[key] || 0;
                  return (
                    <div key={key} style={{ textAlign: "center" }}>
                      <div style={{ width: 24, height: 50, background: "rgba(15,13,10,0.8)", borderRadius: 3, position: "relative", overflow: "hidden", border: "1px solid #0E0D0B" }}>
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${val * 100}%`, background: `linear-gradient(to top,${gold(0.8)},${gold(0.3)})`, borderRadius: 2, transition: "height 0.08s" }} />
                      </div>
                      <div style={{ fontSize: 8, color: "#8A8478", fontFamily: "'Sarabun'", marginTop: 3, fontWeight: 200 }}>{bandNames[i]}</div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
              <Btn onClick={playing ? stopAll : startPreview} sx={{ color: playing ? "#C85050" : gold(0.7), borderColor: playing ? "rgba(200,80,80,0.2)" : "#1E1C18", background: playing ? "rgba(200,80,80,0.06)" : "transparent" }}>
                {playing ? "■  Stop" : "▶  Start Preview"}
              </Btn>
              <Btn primary disabled={exporting} onClick={handleExport}>{exporting ? `Exporting ${exportProg}%` : "⬇  Export WebM"}</Btn>
            </div>

            {exporting && (
              <div style={{ maxWidth: 380, margin: "16px auto 0" }}>
                <div style={{ background: "#080604", borderRadius: 6, overflow: "hidden", height: 3 }}>
                  <div style={{ height: "100%", width: `${exportProg}%`, background: "linear-gradient(90deg,#D4AF37,#F5E6A3)", transition: "width 0.3s", borderRadius: 6 }} />
                </div>
                <div style={{ textAlign: "center", fontSize: 16, color: "#9A948C", fontFamily: "'Sarabun'", fontWeight: 200, marginTop: 6 }}>
                  Export แบบ real-time · ≈ {Math.ceil(totalPlaylistDuration() * loops / 60)} นาที
                </div>
              </div>
            )}

            <div style={{ textAlign: "center", marginTop: 24 }}>
              <Btn onClick={() => { stopAll(); setStep(1); }}>← ย้อนกลับ</Btn>
            </div>
          </div>
        )}

        {/* ═══ DOWNLOAD POPUP ═══ */}
        {downloadUrl && (
          <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
            <div style={{ background: "#0C0A08", border: "1px solid #1E1C18", borderRadius: 14, padding: "36px 40px", maxWidth: 420, width: "90%", textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 16 }}>✓</div>
              <div style={{ fontSize: 18, fontWeight: 400, color: "#F0EDE8", marginBottom: 6 }}>Export สำเร็จ</div>
              <div style={{ fontSize: 14, color: "#8A8478", fontFamily: "'Sarabun'", fontWeight: 200, marginBottom: 24 }}>{downloadName}</div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={() => {
                  const d = downloadBlobRef.current; if (!d) return;
                  const url = URL.createObjectURL(d.blob);
                  const link = document.createElement("a"); link.href = url; link.download = d.name;
                  link.style.display = "none"; document.body.appendChild(link); link.click(); document.body.removeChild(link);
                  setTimeout(() => URL.revokeObjectURL(url), 30000);
                }} style={{ background: "linear-gradient(135deg,#D4AF37,#B8973A)", border: "none", color: "#080604", padding: "12px 36px", borderRadius: 8, fontSize: 14, fontFamily: "'Sarabun'", fontWeight: 600, cursor: "pointer" }}>
                  ⬇  ดาวน์โหลด WebM
                </button>
                <button onClick={() => { URL.revokeObjectURL(downloadUrl); setDownloadUrl(null); setDownloadName(""); downloadBlobRef.current = null; }}
                  style={{ background: "transparent", border: "1px solid #2A2520", color: "#B0AAA2", padding: "12px 28px", borderRadius: 8, fontSize: 14, fontFamily: "'Sarabun'", cursor: "pointer" }}>
                  ปิด
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
