// The panel's status bar, built from the core's `chat.usage` events. Pure, like bottom-bar.ts.
// Exactly three things: the live model, how full its context is, and the chat's tokens used.
import type { AgentEvent } from "../../src/core/events.ts";
import { contextWindowOf, DEFAULT_LIVE_MODEL } from "../../src/models/live-models.ts";

export interface Status {
  model: string;
  contextTokens: number;
  /** The model's context window; undefined for a model we do not know. */
  contextWindow?: number;
  tokensUsed: number;
}

export const startStatus: Status = {
  model: DEFAULT_LIVE_MODEL,
  contextTokens: 0,
  contextWindow: contextWindowOf(DEFAULT_LIVE_MODEL),
  tokensUsed: 0,
};

export function addStatusEvent(status: Status, event: AgentEvent): Status {
  if (event.type === "chat.started") return { ...status, contextTokens: 0, tokensUsed: 0 };
  if (event.type !== "chat.usage") return status;
  const model = event.model ?? status.model;
  return {
    model,
    contextTokens: event.contextTokens,
    ...(event.contextWindow ?? contextWindowOf(model) ? { contextWindow: event.contextWindow ?? contextWindowOf(model) } : {}),
    tokensUsed: event.tokensUsed,
  };
}

/** How full the context is, 0 to 100 (whole numbers); undefined with no known window. */
export function contextPercent(status: Status): number | undefined {
  if (!status.contextWindow) return undefined;
  return Math.min(100, Math.round((status.contextTokens / status.contextWindow) * 100));
}

/** 950, 1.2k, 131k, 1.5M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
