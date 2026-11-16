// Slash commands in the quick-typing box (and the panel's composer). Pure: the text typed in;
// whether it is a command, which one, and what to suggest out. main.ts runs them, so a
// command never reaches Gemini as a typed turn.
//
//   parseSlash("/voice calm")  // { cmd: "voice", arg: "calm" }
//   parseSlash("/nope")        // { unknown: "/nope" }
//   parseSlash("hello")        // undefined: an ordinary message
//   suggest("/v", voices)      // [the /voice row]
//   suggest("/voice c", voices)// the voices whose name or label starts with "c"
import type { Lang } from "./lang.ts";

export type SlashName = "clear" | "voice" | "model" | "help";

export interface SlashCommand {
  name: SlashName;
  /** What to show: "/voice <name>". */
  usage: string;
  /** What it does, in each UI language. */
  what: Record<Lang, string>;
  /** Takes a word after it (Tab / Enter on the suggestion leaves room to type it). */
  takesArg?: boolean;
}

export const COMMANDS: SlashCommand[] = [
  { name: "clear", usage: "/clear", what: { en: "Clear the drawing, start a new chat", zh: "清除画布并开始新对话" } },
  { name: "voice", usage: "/voice <name>", what: { en: "Switch Jett's voice", zh: "切换 Jett 的声音" }, takesArg: true },
  { name: "model", usage: "/model", what: { en: "Pick the Gemini Live model", zh: "选择 Gemini Live 模型" } },
  { name: "help", usage: "/help", what: { en: "List these commands", zh: "列出这些命令" } },
];

export type Parsed = { cmd: SlashName; arg: string } | { unknown: string };

/** A command (or an unknown one, which is never sent either), or undefined for a message. */
export function parseSlash(text: string): Parsed | undefined {
  const t = text.trim();
  const m = /^\/(\S*)\s*([\s\S]*)$/.exec(t);
  if (!m) return undefined;
  const word = m[1]!.toLowerCase();
  const cmd = COMMANDS.find((c) => c.name === word);
  return cmd ? { cmd: cmd.name, arg: m[2]!.trim() } : { unknown: `/${m[1]}` };
}

/** One row of the suggestion list. `insert` replaces the typed text when picked. */
export interface Suggestion {
  label: string;
  detail: string;
  insert: string;
  /** Picking it runs it at once (a full command that takes nothing more). */
  run: boolean;
}

/**
 * What to suggest for the text so far: commands while the first word is typed, voices
 * after "/voice ". Nothing once the text is not a command or a word is complete.
 */
export function suggest(text: string, lang: Lang, voices: { id: string; label: string }[] = []): Suggestion[] {
  if (!text.startsWith("/")) return [];
  const space = text.search(/\s/);
  if (space === -1) {
    const typed = text.slice(1).toLowerCase();
    return COMMANDS.filter((c) => c.name.startsWith(typed)).map((c) => ({
      label: c.usage,
      detail: c.what[lang],
      insert: c.takesArg ? `/${c.name} ` : `/${c.name}`,
      run: !c.takesArg,
    }));
  }
  if (text.slice(1, space).toLowerCase() !== "voice") return [];
  const typed = text.slice(space).trim().toLowerCase();
  return voices
    .filter((v) => v.label.toLowerCase().startsWith(typed) || v.id.toLowerCase().startsWith(typed))
    .map((v) => ({ label: v.label, detail: v.id, insert: `/voice ${v.label}`, run: true }));
}

/** Arrow keys over the list: the next active row, wrapping. */
export function moveActive(active: number, count: number, key: "ArrowDown" | "ArrowUp"): number {
  if (!count) return 0;
  return (active + (key === "ArrowDown" ? 1 : count - 1)) % count;
}
