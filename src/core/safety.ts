// The safety gate: one pure function at the door of every tool call.
// Same idea as live-dj's `before_tool_callback`: nothing runs without a verdict,
// and every verdict goes to the event stream (the core emits it).
//
//   | Risk class | Ask me | Auto edits | Bypass |
//   |------------|--------|------------|--------|
//   | read       | allow  | allow      | allow  |
//   | edit       | ask    | allow      | allow  |
//   | command    | ask    | ask        | allow  |
//   | helper     | ask    | ask        | allow  |
//   | act        | ask    | ask        | allow  |
//
// Per-tool overrides (from the config) win over the table. One rule wins over them:
// an `act` step that clicks or presses something risky (delete, pay, send, sign out...)
// always asks, in every mode, unless the config blocks the tool outright.
import type { SafetyMode, Verdict } from "../config/index.ts";
import type { RiskClass } from "./tool.ts";

// The config owns the words (its schema lists them); the gate uses the same ones.
export type { SafetyMode, Verdict };
export type SafetyOverrides = Record<string, Verdict>;

/** The modes in Shift+Tab order: Ask me -> Auto edits -> Bypass -> back to Ask me. */
export const MODES: readonly SafetyMode[] = ["ask-me", "auto-edits", "bypass"];

/** How each mode is called on screen (the same words as the setup wizard). GET /mode hands these to the window. */
export const MODE_LABELS: Record<SafetyMode, string> = {
  "ask-me": "Ask first",
  "auto-edits": "Auto",
  bypass: "Full access",
};

/** The mode after `mode` in the Shift+Tab cycle. */
export function nextMode(mode: SafetyMode): SafetyMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
}

const TABLE: Record<RiskClass, Record<SafetyMode, Verdict>> = {
  read: { "ask-me": "allow", "auto-edits": "allow", bypass: "allow" },
  edit: { "ask-me": "ask", "auto-edits": "allow", bypass: "allow" },
  command: { "ask-me": "ask", "auto-edits": "ask", bypass: "allow" },
  helper: { "ask-me": "ask", "auto-edits": "ask", bypass: "allow" },
  act: { "ask-me": "ask", "auto-edits": "ask", bypass: "allow" },
};

// Words on a button that can lose data, money, a message or a session. Whole words only:
// "Payments history" and "Sender" are fine, "Pay now" and "Send" are not.
const RISKY_WORDS = /\b(delete|remove|pay|buy|send|submit|sign[\s-]?out|log[\s-]?out|purchase)\b/i;
// Cmd+Delete moves files to the Trash (Finder) or deletes a line or item elsewhere.
const RISKY_KEY = /\b(cmd|command)\b.*\b(delete|backspace|forwarddelete)\b/i;

/**
 * The words that make a computer-control call risky, or undefined. Looks at the steps the
 * tool will click or press (`click_text` text, describe and near; `key` combos), never at
 * words it types: typing "send me the deck" sends nothing.
 */
export function riskyStep(args: Record<string, unknown>): string | undefined {
  const steps = Array.isArray(args.steps) ? args.steps : [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    if (s.do === "click_text") {
      for (const field of ["text", "describe", "near"]) {
        const v = s[field];
        if (typeof v === "string" && RISKY_WORDS.test(v)) return v;
      }
    } else if (s.do === "key" && typeof s.key === "string") {
      if (RISKY_KEY.test(s.key)) return s.key;
    }
  }
  return undefined;
}

export interface GateInput {
  tool: string;
  args: Record<string, unknown>;
  risk: RiskClass;
  mode: SafetyMode;
  overrides?: SafetyOverrides;
}

export function decide({ tool, args, risk, mode, overrides }: GateInput): Verdict {
  const override = overrides?.[tool];
  if (override === "block") return "block";
  if (risk === "act" && riskyStep(args)) return "ask";
  return override ?? TABLE[risk][mode];
}

/** A short, human reason for a verdict. Shown in the app and told to the model. */
export function explain({ tool, args, risk, mode, overrides }: GateInput, verdict: Verdict): string {
  const risky = risk === "act" && overrides?.[tool] !== "block" ? riskyStep(args) : undefined;
  if (risky) return `"${risky}" could delete, pay, send or sign out, so it always asks first`;
  if (overrides?.[tool]) return `the config sets ${tool} to "${verdict}"`;
  return `${risk} tools are "${verdict}" in ${mode} mode`;
}

/** A verdict and its reason. */
export interface Ruling {
  verdict: Verdict;
  reason: string;
}

/** The gate's ruling on one call: a config override, else the mode table. */
export function rule(input: GateInput): Ruling {
  const verdict = decide(input);
  return { verdict, reason: explain(input, verdict) };
}
