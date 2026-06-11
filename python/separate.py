"""StemSep sidecar: separates an audio file into stems.

Protocol: emits JSON lines on stdout consumed by the Tauri shell.
  {"type": "stage",    "stage": str, "message": str}
  {"type": "progress", "percent": int}
  {"type": "done",     "stems": [{"name": str, "path": str}], "output_dir": str}
  {"type": "error",    "message": str}
Library logging goes to stderr (forwarded to the UI log panel).
"""

import argparse
import json
import logging
import re
import sys
from pathlib import Path

# Preset -> (model_filename, friendly stem order)
# Model files are fetched on first use into the audio-separator model cache.
PRESETS = {
    # Highest-quality vocal/instrumental split (BS-Roformer, beats Demucs for 2-stem)
    "vocals": {
        "model": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
        "stems": ["Vocals", "Instrumental"],
    },
    # Classic DJ 4-stem: vocals / drums / bass / other
    "4stem": {
        "model": "htdemucs_ft.yaml",
        "stems": ["Vocals", "Drums", "Bass", "Other"],
    },
    # 6-stem: adds guitar + piano; synths/pads land in Other
    "6stem": {
        "model": "htdemucs_6s.yaml",
        "stems": ["Vocals", "Drums", "Bass", "Guitar", "Piano", "Other"],
    },
}


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def stage(name: str, message: str) -> None:
    emit({"type": "stage", "stage": name, "message": message})


def clean_stem_name(filename: str) -> str:
    """audio-separator names outputs like 'Track_(Vocals)_model.wav' — pull the stem label out."""
    m = re.search(r"\(([^)]+)\)", filename)
    return m.group(1) if m else Path(filename).stem


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--preset", required=True, choices=sorted(PRESETS))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        emit({"type": "error", "message": f"Input file not found: {input_path}"})
        return 1

    preset = PRESETS[args.preset]
    track_name = input_path.stem
    out_dir = Path(args.output) / track_name / args.preset
    out_dir.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(message)s")

    stage("import", "Loading separation engine...")
    from audio_separator.separator import Separator  # deferred: heavy import

    import torch

    if torch.cuda.is_available():
        stage("device", f"GPU acceleration: {torch.cuda.get_device_name(0)} (ROCm)")
    else:
        stage("device", "No GPU detected — running on CPU (much slower)")

    stage("load_model", f"Loading model {preset['model']} (downloads on first run)...")
    separator = Separator(
        log_level=logging.INFO,
        output_dir=str(out_dir),
        output_format="wav",
    )
    separator.load_model(model_filename=preset["model"])

    stage("separate", f"Separating '{track_name}'... this is the long part")
    output_files = separator.separate(str(input_path))

    # Rename outputs to clean, DAW-friendly names: "Track - Vocals.wav"
    stems = []
    for f in output_files:
        p = Path(f)
        if not p.is_absolute():
            p = out_dir / p
        stem_label = clean_stem_name(p.name)
        clean = out_dir / f"{track_name} - {stem_label}.wav"
        if clean != p:
            if clean.exists():
                clean.unlink()
            p.rename(clean)
        stems.append({"name": stem_label, "path": str(clean)})

    # Stable ordering per preset
    order = {name: i for i, name in enumerate(preset["stems"])}
    stems.sort(key=lambda s: order.get(s["name"], 99))

    emit({"type": "done", "stems": stems, "output_dir": str(out_dir)})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # surface anything to the UI
        emit({"type": "error", "message": f"{type(e).__name__}: {e}"})
        sys.exit(1)
