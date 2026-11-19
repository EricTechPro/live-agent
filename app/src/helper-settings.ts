// The Agents view's Helpers section, the pure part: what one click saves. Tested in
// test/helper-settings.test.ts; helper-settings-view.ts is the DOM.
import type { Config } from "../../src/config/index.ts";
import type { SetupAnswers } from "../../src/setup/index.ts";

export type HelperId = Config["defaultHelper"];
export type HelperKey = "codex" | "claudeCode" | "geminiCli";

export const HELPER_CHOICES: readonly { id: HelperId; key: HelperKey; label: string }[] = [
  { id: "codex", key: "codex", label: "Codex" },
  { id: "claude-code", key: "claudeCode", label: "Claude Code" },
  { id: "gemini-cli", key: "geminiCli", label: "Gemini CLI" },
];

export type HelperChange = { type: "default"; id: HelperId } | { type: "toggle"; key: HelperKey };

/**
 * The answers to save for one change, or null when it is not allowed: the last helper
 * on cannot be turned off (nothing could run). Picking an off helper as the default
 * turns it on, so the pick is really used.
 */
export function helperChange(config: Pick<Config, "helpers" | "defaultHelper">, change: HelperChange): SetupAnswers | null {
  if (change.type === "default") {
    const choice = HELPER_CHOICES.find((h) => h.id === change.id)!;
    return { defaultHelper: change.id, ...(config.helpers[choice.key] ? {} : { helpers: { [choice.key]: true } }) };
  }
  const on = !config.helpers[change.key];
  if (!on && HELPER_CHOICES.filter((h) => config.helpers[h.key]).length <= 1) return null;
  return { helpers: { [change.key]: on } };
}
