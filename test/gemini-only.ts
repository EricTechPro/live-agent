// Tests written for the Gemini CLI helper: turn the other helpers off, so a
// start_helper call with no helper named can never reach a real Codex on this machine
// (Codex is on, and the default, in the shipped config).
import type { Config } from "../src/config/index.ts";

export function geminiOnly<T extends Config>(config: T): T {
  return { ...config, helpers: { ...config.helpers, codex: false, claudeCode: false } };
}
