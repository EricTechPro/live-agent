// The setup wizard's rules, with no DOM: which steps show, what each choice is
// called, what the recap says, and the typed answers the core saves.
// app/src/wizard.ts draws them; test/wizard-flow.test.ts checks them.
import type { BrainFolders, Config, SafetyMode, Tone } from "../../src/config/index.ts";
import type { SetupAnswers } from "../../src/setup/index.ts";

export type StepName = "welcome" | "key" | "mic" | "notes" | "tone" | "safety" | "test";
export type Part = keyof BrainFolders;
export const PARTS: Part[] = ["raw", "wiki", "projects"];

/** The brain folder that ships with the app (inside the live-agent folder). */
export const SAMPLE_BRAIN = "sample-brain";

/** Plain words on the chips; the Gemini Live voice name is what the config keeps. */
export const VOICES: { id: string; label: string; line: string }[] = [
  { id: "Puck", label: "Upbeat", line: "Hey hey!" },
  { id: "Charon", label: "Calm", line: "Hello. Nice to meet you." },
  { id: "Kore", label: "Firm", line: "Ready when you are." },
  { id: "Zephyr", label: "Bright", line: "Hi! This is fun!" },
];

export const TONES: Record<Tone, { label: string; line: string }> = {
  short: { label: "Short", line: "Got it." },
  casual: { label: "Casual", line: "Cool, got it." },
  friendly: { label: "Friendly", line: "Yay, friendly it is!" },
  pro: { label: "Professional", line: "Understood." },
};

export const MODES: Record<SafetyMode, { label: string; line: string }> = {
  "ask-me": { label: "Ask first", line: "I'll always ask!" },
  "auto-edits": { label: "Auto", line: "Good pick!" },
  bypass: { label: "Full access", line: "Wow. Careful!" },
};

/** What the bubble says when each step opens. */
export const STEP_LINES: Record<StepName, string> = {
  welcome: "Hi there!",
  key: "I need a brain!",
  mic: "Click Allow when it asks!",
  notes: "Where do notes live?",
  tone: "How should I sound?",
  safety: "How careful?",
  test: "Last one. Say hi!",
};

/** Each step's pixel icon on the stage, so the orb shows where you are. */
export const STEP_ICONS: Record<StepName | "end", string> = {
  welcome: "wave",
  key: "key",
  mic: "mic",
  notes: "folder",
  tone: "bubble",
  safety: "shield",
  test: "hi",
  end: "hi",
};

/** What one part maps to: an existing top-level folder, or "" for "create a new one". */
export type PartChoice = { folder: string; found: boolean };

export interface FolderTree {
  name: string;
  path: string;
  folders: { name: string; files: number; capped?: boolean }[];
  notes: number;
  capped: boolean;
}

export interface WizardState {
  voice: string;
  key: boolean;
  mic: boolean;
  notes: "sample" | "folder" | null;
  /** The folder picked (or the sample brain's name). */
  notesPath: string;
  /** The picked folder's scan, for the map. */
  tree: FolderTree | null;
  /** The map of parts to folders (only for "folder"). */
  brain: Record<Part, PartChoice> | null;
  tone: Tone;
  mode: SafetyMode;
}

/** Where the wizard starts: the config as it is now (defaults on a first launch). */
export function initialState(current: Config, keyNeeded: boolean): WizardState {
  const sample = current.brainPath === SAMPLE_BRAIN;
  return {
    voice: VOICES.some((v) => v.id === current.voice) ? current.voice : "Puck",
    key: !keyNeeded,
    mic: false,
    // A re-run keeps the folder already in use; a first run picks again.
    notes: sample ? null : "folder",
    notesPath: sample ? "" : current.brainPath,
    tree: null,
    brain: sample
      ? null
      : (Object.fromEntries(PARTS.map((p) => [p, { folder: current.brainFolders[p], found: true }])) as WizardState["brain"]),
    tone: current.tone,
    mode: current.safety.mode,
  };
}

/** The steps in order. A key that is already saved drops its step. */
export function wizardSteps(keyNeeded: boolean): StepName[] {
  const all: StepName[] = ["welcome", "key", "mic", "notes", "tone", "safety", "test"];
  return keyNeeded ? all : all.filter((s) => s !== "key");
}

/** May Continue be pressed on this step? (Mic has its own Skip.) */
export function stepReady(step: StepName, state: WizardState, saved: boolean): boolean {
  switch (step) {
    case "key":
      return state.key;
    case "mic":
      return state.mic;
    case "notes":
      return !!state.notes && (state.notes === "sample" || !!state.brain);
    case "test":
      return saved;
    default:
      return true;
  }
}

/** The folder each part will use: the mapped one, or the part's own name when it is created new. */
export function partFolders(state: WizardState): BrainFolders {
  const out = { raw: "raw", wiki: "wiki", projects: "projects" };
  if (state.notes === "folder" && state.brain) for (const p of PARTS) out[p] = state.brain[p].folder || p;
  return out;
}

/** The typed answers for POST /setup/save. */
export function answersFrom(state: WizardState): SetupAnswers {
  return {
    voice: state.voice,
    tone: state.tone,
    safetyMode: state.mode,
    brainPath: state.notes === "sample" ? SAMPLE_BRAIN : state.notesPath,
    brainFolders: partFolders(state),
  };
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** The status line under one part in the map. */
export function partStatus(choice: PartChoice, tree: FolderTree | null): string {
  if (!choice.folder) return "I'll make this folder.";
  const top = tree?.folders.find((f) => f.name === choice.folder);
  if (!top) return "using"; // a nested folder picked by hand: not counted
  return `${choice.found ? "found" : "using"} · ${plural(top.files, "file")}${top.capped ? "+" : ""}`;
}

/** The message after a folder is picked and scanned. */
export function folderMessage(tree: FolderTree, brain: Record<Part, PartChoice>): { msg: string; say: string } {
  if (!tree.folders.length && !tree.notes) return { msg: "Empty folder. I'll set up raw, wiki, projects for you.", say: "Fresh start!" };
  const found = PARTS.filter((p) => brain[p].found).length;
  return {
    msg: `Found ${plural(tree.notes, "note")}${tree.capped ? "+" : ""} in ${tree.name}.`,
    say: found ? `Found ${found} of 3 parts!` : "New brain. I set it up!",
  };
}

/** The recap rows on the last step: label, value, and the step its Change link opens. */
export function recapRows(state: WizardState): { label: string; value: string; step: StepName }[] {
  const voice = VOICES.find((v) => v.id === state.voice)?.label ?? state.voice;
  const rows: { label: string; value: string; step: StepName }[] = [
    { label: "Voice", value: voice, step: "welcome" },
    { label: "Brain", value: state.key ? "Gemini, connected" : "Not yet", step: "key" },
    { label: "Mic", value: state.mic ? "Allowed" : "Off, I type", step: "mic" },
    { label: "Notes", value: state.notes === "sample" ? "Sample notes" : state.notesPath || "Not yet", step: "notes" },
  ];
  if (state.notes === "folder" && state.brain) {
    rows.push({ label: "Folders", value: PARTS.map((p) => `${p} → ${state.brain![p].folder || "new"}`).join(", "), step: "notes" });
  }
  rows.push({ label: "Tone", value: TONES[state.tone].label, step: "tone" }, { label: "Safety", value: MODES[state.mode].label, step: "safety" });
  return rows;
}
