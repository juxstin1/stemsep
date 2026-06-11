export type PresetId = "vocals" | "4stem" | "6stem";

export interface Stem {
  name: string;
  path: string;
}

export interface PresetDef {
  id: PresetId;
  title: string;
  blurb: string;
  stems: string[];
}

export const PRESETS: PresetDef[] = [
  {
    id: "vocals",
    title: "Acapella / Instrumental",
    blurb: "BS-Roformer · highest-quality vocal split",
    stems: ["Vocals", "Instrumental"],
  },
  {
    id: "4stem",
    title: "DJ 4-Stem",
    blurb: "Demucs ft · classic deck stems",
    stems: ["Vocals", "Drums", "Bass", "Other"],
  },
  {
    id: "6stem",
    title: "Producer 6-Stem",
    blurb: "Demucs 6s · grab guitar + piano too",
    stems: ["Vocals", "Drums", "Bass", "Guitar", "Piano", "Other"],
  },
];

export const STEM_COLORS: Record<string, string> = {
  Vocals: "#5ee9ff",
  Instrumental: "#c8ff3d",
  Drums: "#ffb454",
  Bass: "#ff5e8e",
  Guitar: "#b18cff",
  Piano: "#7cffb2",
  Other: "#c8ff3d",
};

export const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "aiff", "aif", "m4a", "ogg", "opus"];
