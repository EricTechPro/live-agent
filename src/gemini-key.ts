// The Gemini key: the one place that knows where it comes from.
//
// GEMINI_API_KEY is the name we document; GOOGLE_API_KEY is the name AI Studio
// suggests, so both work. An empty value (the installer's blank template line)
// counts as no key. The voice, the helper, the tidy job, setup and the doctor
// all read it through here, so they can never disagree about it.
export function geminiApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || undefined;
}
