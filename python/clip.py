"""Cut a time range out of a WAV file. Fast path used by 'Save selection as WAV'."""

import argparse
import sys

import soundfile as sf


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--start", type=float, required=True, help="seconds")
    parser.add_argument("--end", type=float, required=True, help="seconds")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    info = sf.info(args.input)
    start = max(0, int(args.start * info.samplerate))
    end = min(info.frames, int(args.end * info.samplerate))
    if end <= start:
        print("empty selection", file=sys.stderr)
        return 1

    data, sr = sf.read(args.input, start=start, stop=end)
    sf.write(args.output, data, sr, subtype=info.subtype)
    return 0


if __name__ == "__main__":
    sys.exit(main())
