import { useEffect, useMemo, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { STEM_COLORS, type Stem } from "./types";

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

  const stemKey = useMemo(() => stems.map((s) => s.path).join("|"), [stems]);

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setReadyCount(0);
    setMuted(new Set());
    setSolo(new Set());
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

  return (
    <div className="stem-rack">
      <div className="transport">
        <button className="play-btn" onClick={togglePlay} disabled={!allReady}>
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="time mono">
          {fmtTime(time)} <span className="time-dim">/ {fmtTime(duration)}</span>
        </span>
        <span className="transport-hint mono">{allReady ? "SPACE = play · click wave = seek" : "decoding waveforms..."}</span>
      </div>

      {stems.map((stem) => {
        const color = STEM_COLORS[stem.name] ?? "#c8ff3d";
        const isMuted = muted.has(stem.name);
        const isSolo = solo.has(stem.name);
        const silenced = isMuted || (solo.size > 0 && !isSolo);
        return (
          <div className={`stem-row ${silenced ? "silenced" : ""}`} key={stem.name}>
            <div className="stem-side" style={{ ["--stem" as string]: color }}>
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
    </div>
  );
}
