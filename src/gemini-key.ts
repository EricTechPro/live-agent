// The Gemini key: the one place that knows where it comes from.
//
// GEMINI_API_KEY is the name we document; GOOGLE_API_KEY is the name AI Studio
// suggests, so both work. An empty value (the installer's blank template line)
// counts as no key. The voice, the helper, the tidy job, setup and the doctor
// all read it through here, so they can never disagree about it.
export function geminiApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || undefined;
}

import { DEFAULT_LIVE_MODEL } from "./models/gemini-live.ts";

const KEY_HELP = "Make one in Google AI Studio (https://aistudio.google.com/apikey) and paste it again.";

/** What Google said about a key: a model lookup, which uses no tokens. */
export type KeyVerdict = "ok" | "over-quota" | "offline" | "invalid" | "forbidden" | "no-model" | { status: number };

/**
 * Look the model up with this key. The doctor and the window both start here,
 * then say it in their own words.
 */
export async function lookupGeminiKey(
  key: string,
  { fetch: get = fetch, model = DEFAULT_LIVE_MODEL }: { fetch?: typeof fetch; model?: string } = {},
): Promise<KeyVerdict> {
  // The key goes in a header, so it never lands in a URL or a log.
  const res = await get(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res) return "offline";
  if (res.ok) return "ok";
  if (res.status === 429) return "over-quota";
  const body: any = await res.json().catch(() => ({}));
  const reason = body?.error?.details?.find((x: any) => x?.reason)?.reason;
  if (res.status === 400 && reason === "API_KEY_INVALID") return "invalid";
  if (res.status === 403) return "forbidden";
  if (res.status === 404) return "no-model";
  return { status: res.status };
}

/**
 * Does this key work? Undefined when it does, else one plain sentence for the
 * window (never containing the key). Over quota counts as working: the key is fine.
 */
export async function verifyGeminiKey(
  key: string,
  options: { fetch?: typeof fetch; model?: string } = {},
): Promise<string | undefined> {
  const verdict = await lookupGeminiKey(key, options);
  if (verdict === "ok" || verdict === "over-quota") return undefined;
  if (verdict === "offline") return "Could not reach Google. Check your internet connection and try again.";
  if (verdict === "invalid") return `That key is not valid. ${KEY_HELP}`;
  if (verdict === "forbidden") return `This key may not use the Gemini API. ${KEY_HELP}`;
  if (verdict === "no-model") return `Model ${options.model ?? DEFAULT_LIVE_MODEL} is not available for this key. ${KEY_HELP}`;
  return `Google refused the key (${verdict.status}). ${KEY_HELP}`;
}
