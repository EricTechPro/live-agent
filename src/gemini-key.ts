// The Gemini key: the one place that knows where it comes from.
//
// GEMINI_API_KEY is the name we document; GOOGLE_API_KEY is the name AI Studio
// suggests, so both work. An empty value (the installer's blank template line)
// counts as no key. The voice, the helper, the tidy job, setup and the doctor
// all read it through here, so they can never disagree about it.
export function geminiApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || undefined;
}

const KEY_HELP = "Make one in Google AI Studio (https://aistudio.google.com/apikey) and paste it again.";

/**
 * Does this key work? Undefined when it does, else one plain sentence for the
 * window (never containing the key). The same cheap check as the doctor: a model
 * lookup, which uses no tokens. Over quota counts as working: the key is fine.
 */
export async function verifyGeminiKey(
  key: string,
  { fetch: get = fetch, model = "gemini-3.8-live" }: { fetch?: typeof fetch; model?: string } = {},
): Promise<string | undefined> {
  // The key goes in a header, so it never lands in a URL or a log.
  const res = await get(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, {
    headers: { "x-goog-api-key": key },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res) return "Could not reach Google. Check your internet connection and try again.";
  if (res.ok || res.status === 429) return undefined;
  const body: any = await res.json().catch(() => ({}));
  const reason = body?.error?.details?.find((x: any) => x?.reason)?.reason;
  if (res.status === 400 && reason === "API_KEY_INVALID") return `That key is not valid. ${KEY_HELP}`;
  if (res.status === 403) return `This key may not use the Gemini API. ${KEY_HELP}`;
  if (res.status === 404) return `Model ${model} is not available for this key. ${KEY_HELP}`;
  return `Google refused the key (${res.status}). ${KEY_HELP}`;
}
