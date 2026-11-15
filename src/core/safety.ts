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
//
// Per-tool overrides (from the config) win over everything.
import type { SafetyMode, Verdict } from "../config/index.ts";
import type { RiskClass } from "./tool.ts";

// The config owns the words (its schema lists them); the gate uses the same ones.
export type { SafetyMode, Verdict };
export type SafetyOverrides = Record<string, Verdict>;

/** The modes in Shift+Tab order: Ask me -> Auto edits -> Bypass -> back to Ask me. */
export const MODES: readonly SafetyMode[] = ["ask-me", "auto-edits", "bypass"];

/** How each mode is called on screen. GET /mode hands these to the window, so they live with the modes. */
export const MODE_LABELS: Record<SafetyMode, string> = {
  "ask-me": "Ask me",
  "auto-edits": "Auto edits",
  bypass: "Bypass",
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
};

export interface GateInput {
  tool: string;
  args: Record<string, unknown>;
  risk: RiskClass;
  mode: SafetyMode;
  overrides?: SafetyOverrides;
}

export function decide({ tool, risk, mode, overrides }: GateInput): Verdict {
  return overrides?.[tool] ?? TABLE[risk][mode];
}

/** A short, human reason for a verdict. Shown in the app and told to the model. */
export function explain({ tool, risk, mode, overrides }: GateInput, verdict: Verdict): string {
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
