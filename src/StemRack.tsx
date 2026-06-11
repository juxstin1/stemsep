import { useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.esm.js";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { STEM_COLORS, type Stem } from "./types";

// waveform chip shown under the cursor while dragging a stem out
const DRAG_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAABxElEQVR4nO3cQU7DMBCF4STqEeAeLNlwAJ/YB2DDknvQOxR1EQkFJ3UaT+d5+n8SC6RWOPM8dhIhDwMAAAAAAAAAAAAAIKpxz4e/Lh8Xu6HE8j5+VtW26kMU3i6IcW/x0+v3+cB4nkL+eXupDWGsLT6FPxbEWgjjreJT+HZBlEKYSl9gzbdRqmsxgBmzv42tOv4LgNlva1nf1Q5g9re1Vs/NJQj2CMAZATgjAGcE4IwAnJ0GsXcmSfBln+X4JrU3h3nxe/TxSXRA9A6S7gCFGXr9zvwzRAzA8wLVl8Ap+gWq62IPyB2v8d3vAbmDDjqyxJ6eYYZmw/GVJsievzFFn6FZfHzyS1B0BOCMAJwRgDMCcEYAzgjAWfgA0uKhSO1B8fCT8PWC1J+Ek+CYmr6KUL5Aa0cnoPzb0BS8w+QDUC16N5uw+iaYnMf3kA5QK7rS+Lq/DU3iHRZiD7jFsujWNwHuAaTgdznyAagW/VG63wN6RwDOCMAZATgjAGcEoBqA2j8w9W6tntO9Jz3hPsv6bi5BdEEbW3UsBkAX2CjVlROzVE/MmnFmnOOZcTPOEHI8NfEvgqjHPgoAAAAAAAAAAABg8PcLi4voGqbJfVwAAAAASUVORK5CYII=";

function fmtTime(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

interface Props {
  stems: Stem[];
}

export function StemRack({ stems }: Props) {
  const containerRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const wavesRef = useRef<Map<string, WaveSurfer>>(new Map());
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [readyCount, setReadyCount] = useState(0);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; stem: Stem } | null>(null);
  const [savedFlash, setSavedFlash] = useState("");
  // one highlighted range per stem: drag on a waveform to create it
  const [selections, setSelections] = useState<Map<string, { start: number; end: number }>>(new Map());
  const regionsRef = useRef<Map<string, RegionsPlugin>>(new Map());

  const stemKey = useMemo(() => stems.map((s) => s.path).join("|"), [stems]);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setReadyCount(0);
    setMuted(new Set());
    setSolo(new Set());
    setSelections(new Map());
    regionsRef.current = new Map();
    const waves = new Map<string, WaveSurfer>();

    stems.forEach((stem, i) => {
      const el = containerRefs.current.get(stem.name);
      if (!el) return;
      const color = STEM_COLORS[stem.name] ?? "#c8ff3d";
      const ws = WaveSurfer.create({
        container: el,
        url: convertFileSrc(stem.path),
        height: 72,
        waveColor: color + "55",
        progressColor: color,
        cursorColor: "#f2ffe0",
        cursorWidth: 1,
        barWidth: 2,
        barGap: 1,
        barRadius: 1,
        normalize: true,
        interact: true,
      });
      ws.on("ready", () => {
        setReadyCount((c) => c + 1);
        if (i === 0) setDuration(ws.getDuration());
      });
      // drag on the waveform = highlight a range (one per stem)
      const regions = ws.registerPlugin(RegionsPlugin.create());
      regions.enableDragSelection({ color: color + "2e" });
      const syncSelection = (r: Region) => {
        setSelections((prev) => new Map(prev).set(stem.name, { start: r.start, end: r.end }));
      };
      regions.on("region-created", (r: Region) => {
        regions.getRegions().forEach((other) => other !== r && other.remove());
        syncSelection(r);
      });
      regions.on("region-updated", syncSelection);
      regionsRef.current.set(stem.name, regions);
      // any waveform click seeks every deck
      ws.on("interaction", (newTime: number) => {
        waves.forEach((other) => {
          if (other !== ws) other.setTime(newTime);
        });
        setTime(newTime);
      });
      if (i === 0) {
        ws.on("timeupdate", (t: number) => setTime(t));
        ws.on("finish", () => setPlaying(false));
      }
      waves.set(stem.name, ws);
    });

    wavesRef.current = waves;
    return () => {
      waves.forEach((ws) => ws.destroy());
      wavesRef.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemKey]);

  // apply solo/mute matrix
  useEffect(() => {
    wavesRef.current.forEach((ws, name) => {
      const silenced = muted.has(name) || (solo.size > 0 && !solo.has(name));
      ws.setMuted(silenced);
    });
  }, [muted, solo, readyCount]);

  const allReady = readyCount >= stems.length && stems.length > 0;

  const togglePlay = () => {
    if (!allReady) return;
    const next = !playing;
    wavesRef.current.forEach((ws) => (next ? ws.play() : ws.pause()));
    setPlaying(next);
  };

  // space bar = transport
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, allReady]);

  const toggleMute = (name: string) => {
    setMuted((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const toggleSolo = (name: string) => {
    setSolo((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  // dismiss context menu on any click or Escape
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onEsc);
    };
  }, [menu]);

  const saveStemAs = async (stem: Stem) => {
    setMenu(null);
    const dest = await save({
      defaultPath: stem.path.split(/[\\/]/).pop(),
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    });
    if (!dest) return;
    await invoke("copy_file", { src: stem.path, dest });
    setSavedFlash(stem.name);
    setTimeout(() => setSavedFlash(""), 2000);
  };

  const revealStem = (stem: Stem) => {
    setMenu(null);
    invoke("reveal_item", { path: stem.path });
  };

  const saveSelectionAs = async (stem: Stem) => {
    const sel = selections.get(stem.name);
    setMenu(null);
    if (!sel) return;
    const base = stem.path.split(/[\\/]/).pop()!.replace(/\.wav$/i, "");
    const tag = `${fmtTime(sel.start)}-${fmtTime(sel.end)}`.replace(/:/g, ".");
    const dest = await save({
      defaultPath: `${base} [${tag}].wav`,
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    });
    if (!dest) return;
    try {
      await invoke("export_clip", { src: stem.path, start: sel.start, end: sel.end, dest });
      setSavedFlash(`${stem.name} ${tag}`);
    } catch (e) {
      setSavedFlash(`ERROR: ${e}`);
    }
    setTimeout(() => setSavedFlash(""), 3000);
  };

  const clearSelection = (stem: Stem) => {
    setMenu(null);
    regionsRef.current.get(stem.name)?.clearRegions();
    setSelections((prev) => {
      const next = new Map(prev);
      next.delete(stem.name);
      return next;
    });
  };

  return (
    <div className="stem-rack">
      <div className="transport">
        <button className="play-btn" onClick={togglePlay} disabled={!allReady}>
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="time mono">
          {fmtTime(time)} <span className="time-dim">/ {fmtTime(duration)}</span>
        </span>
        <span className="transport-hint mono">
          {savedFlash
            ? `✓ ${savedFlash.toUpperCase()} SAVED`
            : allReady
              ? "drag wave = highlight · right-click = save · drag label → DAW"
              : "decoding waveforms..."}
        </span>
      </div>

      {stems.map((stem) => {
        const color = STEM_COLORS[stem.name] ?? "#c8ff3d";
        const isMuted = muted.has(stem.name);
        const isSolo = solo.has(stem.name);
        const silenced = isMuted || (solo.size > 0 && !isSolo);
        return (
          <div
            className={`stem-row ${silenced ? "silenced" : ""}`}
            key={stem.name}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, stem });
            }}
          >
            <div
              className="stem-side"
              style={{ ["--stem" as string]: color }}
              draggable
              title="Drag out to drop this stem into rekordbox, Ableton or Explorer"
              onDragStart={(e) => {
                e.preventDefault();
                startDrag({ item: [stem.path], icon: DRAG_ICON });
              }}
            >
              <span className="stem-label mono">{stem.name.toUpperCase()}</span>
              <div className="stem-btns">
                <button className={`chip-btn ${isMuted ? "active-mute" : ""}`} onClick={() => toggleMute(stem.name)} title="Mute">
                  M
                </button>
                <button className={`chip-btn ${isSolo ? "active-solo" : ""}`} onClick={() => toggleSolo(stem.name)} title="Solo">
                  S
                </button>
              </div>
            </div>
            <div
              className="stem-wave"
              ref={(el) => {
                if (el) containerRefs.current.set(stem.name, el);
                else containerRefs.current.delete(stem.name);
              }}
            />
          </div>
        );
      })}

      {menu && (
        <div
          className="ctx-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 240),
            top: Math.min(menu.y, window.innerHeight - 96),
            ["--stem" as string]: STEM_COLORS[menu.stem.name] ?? "#c8ff3d",
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span className="ctx-title mono">{menu.stem.name.toUpperCase()}</span>
          {selections.has(menu.stem.name) && (
            <>
              <button className="ctx-primary" onClick={() => saveSelectionAs(menu.stem)}>
                Save selection as WAV…{" "}
                <span className="mono ctx-range">
                  {fmtTime(selections.get(menu.stem.name)!.start)}–{fmtTime(selections.get(menu.stem.name)!.end)}
                </span>
              </button>
              <button onClick={() => clearSelection(menu.stem)}>Clear selection</button>
            </>
          )}
          <button onClick={() => saveStemAs(menu.stem)}>Save full stem as WAV…</button>
          <button onClick={() => revealStem(menu.stem)}>Reveal in Explorer</button>
        </div>
      )}
    </div>
  );
}
