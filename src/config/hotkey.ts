// The hold-to-draw key (ticket 45): hold it to talk and draw a circle on the screen. Ctrl+Option
// by default; `drawHotkey` in the config (and the Agents tab's settings) changes it. Two
// modifiers or more, plus at most one letter or digit: "ctrl+option", "option+cmd", "ctrl+cmd+d".
// Pure, no Zod: the config, the settings view and the window all use it.

export const MODS = ["ctrl", "option", "cmd", "shift"] as const;
export type Mod = (typeof MODS)[number];
export const DEFAULT_DRAW_HOTKEY = "ctrl+option";

/** Jett's own global shortcuts (app/src-tauri/src/lib.rs): a draw key may not be one. */
export const RESERVED: readonly { combo: string; what: string }[] = [
  { combo: "ctrl+option+t", what: "quick type (⌃⌥T)" },
  { combo: "ctrl+option+s", what: "show or hide Jett (⌃⌥S)" },
];

export function parseHotkey(text: string): { mods: Mod[]; key?: string } | undefined {
  const parts = text.trim().toLowerCase().split("+").filter(Boolean);
  const mods = MODS.filter((m) => parts.includes(m));
  const rest = parts.filter((p) => !(MODS as readonly string[]).includes(p));
  if (mods.length < 2 || rest.length > 1 || mods.length + rest.length !== parts.length) return undefined;
  if (rest[0] !== undefined && !/^[a-z0-9]$/.test(rest[0])) return undefined;
  return { mods, key: rest[0] };
}

const canonical = (h: { mods: Mod[]; key?: string }) => [...h.mods, ...(h.key ? [h.key] : [])].join("+");

/** Why this combo cannot be the draw key, in plain words; undefined when it is fine. */
export function hotkeyConflict(text: string): string | undefined {
  const h = parseHotkey(text);
  if (!h) return "hold two modifier keys or more (⌃ ⌥ ⌘ ⇧), plus at most one letter or digit";
  const taken = RESERVED.find((r) => canonical(parseHotkey(r.combo)!) === canonical(h));
  if (taken) return `${formatHotkey(text)} is Jett's ${taken.what}`;
  return undefined;
}

const SYMBOL: Record<Mod, string> = { ctrl: "⌃", option: "⌥", shift: "⇧", cmd: "⌘" };
/** In the Mac's own order and symbols: "ctrl+option" -> "⌃⌥". */
export function formatHotkey(text: string): string {
  const h = parseHotkey(text);
  if (!h) return text;
  const order: Mod[] = ["ctrl", "option", "shift", "cmd"];
  return order.filter((m) => h.mods.includes(m)).map((m) => SYMBOL[m]).join("") + (h.key?.toUpperCase() ?? "");
}

/** Is the draw key held? Exactly its modifiers (the others up), and its letter when it has one. */
export function holdMatches(text: string, held: Record<Mod, boolean>, keyDown = false): boolean {
  const h = parseHotkey(text);
  if (!h) return false;
  return MODS.every((m) => held[m] === h.mods.includes(m)) && (!h.key || keyDown);
}

/** The combo a key press shows (the settings' recorder). Uses the physical key: Option changes the letter. */
export function comboFrom(e: { ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean; key: string; code?: string }): string {
  const mods = MODS.filter((m) => ({ ctrl: e.ctrlKey, option: e.altKey, cmd: e.metaKey, shift: e.shiftKey })[m]);
  const key = e.code?.match(/^(?:Key([A-Z])|Digit([0-9]))$/);
  const letter = key ? (key[1] ?? key[2])!.toLowerCase() : undefined;
  return [...mods, ...(letter ? [letter] : [])].join("+");
}
