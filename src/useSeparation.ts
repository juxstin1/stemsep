import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PresetId, Stem } from "./types";

export type SepStatus = "idle" | "running" | "done" | "error";

interface SepEvent {
  type: "stage" | "progress" | "done" | "error";
  stage?: string;
  message?: string;
  percent?: number;
  stems?: Stem[];
  output_dir?: string;
}

export function useSeparation() {
  const [status, setStatus] = useState<SepStatus>("idle");
  const [stageMessage, setStageMessage] = useState("");
  const [error, setError] = useState("");
  const [stems, setStems] = useState<Stem[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    const unlisteners: Promise<UnlistenFn>[] = [
      listen<SepEvent>("sep:event", (e) => {
        const ev = e.payload;
        if (ev.type === "stage") {
          setStageMessage(ev.message ?? ev.stage ?? "");
        } else if (ev.type === "done") {
          setStems(ev.stems ?? []);
          setOutputDir(ev.output_dir ?? "");
          setStatus("done");
        } else if (ev.type === "error") {
          setError(ev.message ?? "Unknown error");
          setStatus("error");
        }
      }),
      listen<string>("sep:log", (e) => {
        setLogs((prev) => [...prev.slice(-200), e.payload]);
      }),
    ];
    return () => {
      unlisteners.forEach((u) => u.then((fn) => fn()));
    };
  }, []);

  useEffect(() => {
    if (status !== "running") return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  const start = useCallback(async (input: string, preset: PresetId, outputDirBase: string) => {
    setStatus("running");
    setStageMessage("Starting engine...");
    setError("");
    setStems([]);
    setLogs([]);
    setElapsed(0);
    startedAt.current = Date.now();
    try {
      await invoke("start_separation", { input, preset, outputDir: outputDirBase });
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, []);

  const cancel = useCallback(async () => {
    try {
      await invoke("cancel_separation");
    } catch {
      // already finished — ignore
    }
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setStems([]);
    setError("");
    setStageMessage("");
  }, []);

  return { status, stageMessage, error, stems, outputDir, logs, elapsed, start, cancel, reset };
}
