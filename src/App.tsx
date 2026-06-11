import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { StemRack } from "./StemRack";
import { useSeparation } from "./useSeparation";
import { AUDIO_EXTENSIONS, PRESETS, STEM_COLORS, type PresetId } from "./types";
import "./App.css";

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx > 0 ? p.slice(0, idx) : p;
}

function isAudioFile(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSIONS.includes(ext);
}

function fmtElapsed(s: number): string {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

export default function App() {
  const [file, setFile] = useState<string>("");
  const [preset, setPreset] = useState<PresetId>("4stem");
  const [dragOver, setDragOver] = useState(false);
  const sep = useSeparation();
  const logRef = useRef<HTMLDivElement>(null);

  // native file drop from the OS
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragOver(true);
      } else if (event.payload.type === "drop") {
        setDragOver(false);
        const audio = event.payload.paths.find(isAudioFile);
        if (audio) setFile(audio);
      } else {
        setDragOver(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [sep.logs]);

  const pickFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (typeof selected === "string") setFile(selected);
  };

  const outputBase = useMemo(() => (file ? `${parentDir(file)}\\Stems` : ""), [file]);
  const activePreset = PRESETS.find((p) => p.id === preset)!;
  const running = sep.status === "running";

  const go = () => {
    if (!file || running) return;
    sep.start(file, preset, outputBase);
  };

  return (
    <div className={`shell ${dragOver ? "drag-over" : ""}`}>
      {/* ── left rail ───────────────────────────── */}
      <aside className="rail">
        <header className="brand">
          <h1>
            STEM<span>SEP</span>
          </h1>
          <p className="mono">SOURCE SEPARATION DECK</p>
        </header>

        <section className="rail-section">
          <h2 className="rail-title mono">01 / TRACK</h2>
          <button className="file-btn" onClick={pickFile}>
            {file ? (
              <span className="file-name">{baseName(file)}</span>
            ) : (
              <span className="file-placeholder">Browse for audio…</span>
            )}
          </button>
        </section>

        <section className="rail-section">
          <h2 className="rail-title mono">02 / MODE</h2>
          <div className="preset-list">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`preset-card ${preset === p.id ? "selected" : ""}`}
                onClick={() => setPreset(p.id)}
                disabled={running}
              >
                <span className="preset-title">{p.title}</span>
                <span className="preset-blurb mono">{p.blurb}</span>
                <span className="preset-chips">
                  {p.stems.map((s) => (
                    <i key={s} style={{ background: STEM_COLORS[s] }} title={s} />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rail-section grow">
          <h2 className="rail-title mono">03 / RUN</h2>
          {running ? (
            <button className="go-btn cancel" onClick={sep.cancel}>
              ABORT
            </button>
          ) : (
            <button className="go-btn" onClick={go} disabled={!file}>
              SEPARATE ⟶
            </button>
          )}
          {sep.status === "done" && sep.outputDir && (
            <button className="open-btn mono" onClick={() => invoke("open_folder", { path: sep.outputDir })}>
              ⌖ OPEN STEMS FOLDER
            </button>
          )}
        </section>

        <footer className="rail-foot mono">
          {file ? `out → ${outputBase}` : "wav out · rekordbox + ableton ready"}
        </footer>
      </aside>

      {/* ── main stage ──────────────────────────── */}
      <main className="stage">
        {sep.status === "done" && sep.stems.length > 0 ? (
          <StemRack stems={sep.stems} />
        ) : running ? (
          <div className="progress-stage">
            <div className="vu">
              {Array.from({ length: 24 }).map((_, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.07}s` }} />
              ))}
            </div>
            <h2 className="progress-msg">{sep.stageMessage}</h2>
            <p className="mono progress-meta">
              {activePreset.title} · {fmtElapsed(sep.elapsed)} elapsed
            </p>
            <div className="log-panel mono" ref={logRef}>
              {sep.logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          </div>
        ) : (
          <div className={`drop-zone ${dragOver ? "hot" : ""}`} onClick={pickFile}>
            <div className="corner tl" />
            <div className="corner tr" />
            <div className="corner bl" />
            <div className="corner br" />
            <p className="drop-big">
              DROP A<br />
              TRACK
            </p>
            <p className="drop-sub mono">
              {file ? `${baseName(file)} — hit SEPARATE ⟶` : "mp3 · wav · flac · aiff · m4a — or click to browse"}
            </p>
            {sep.status === "error" && <p className="error mono">✕ {sep.error}</p>}
          </div>
        )}
      </main>
    </div>
  );
}
