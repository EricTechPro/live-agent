// The Gemini Live models we know, with no SDK import, so the window can use it too.
//
// Context window = the model's input token limit, from Google's model pages
// (https://aistudio.google.com/docs/models/gemini-3.8-live: input 131,072, output 65,536).

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";

const CONTEXT_WINDOWS: Record<string, number> = {
  "gemini-3.8-live": 131_072,
};

/** The model's context window in tokens, or undefined for a model not in the table. */
export function contextWindowOf(model: string | undefined): number | undefined {
  return model ? CONTEXT_WINDOWS[model] : undefined;
}
