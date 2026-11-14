// The real tidy model: one Gemini text call (not Live) that turns raw notes into wiki pages.
//
//   startSession({ model, tidy: geminiTidyModel({ apiKey }) });
//
// It only returns pages; src/brain/tidy.ts checks the paths and writes them.
// Structured JSON output, so the answer is always `{ pages: [{ path, content }] }`.
import { GoogleGenAI } from "@google/genai";
import type { TidyModel, WikiPage } from "../brain/tidy.ts";
import tidyPrompt from "../../prompts/tidy.md" with { type: "text" };

export interface GeminiTidyOptions {
  apiKey: string;
  /** A Gemini text model. Default "gemini-3.8-flash". */
  model?: string;
}

// The words live in prompts/tidy.md, so people can read and copy them (the kit).
const INSTRUCTIONS = tidyPrompt.trim();

const SCHEMA = {
  type: "object",
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: 'e.g. "wiki/sourdough-starter.md"' },
          content: { type: "string", description: "the whole page, markdown" },
        },
        required: ["path", "content"],
      },
    },
  },
  required: ["pages"],
};

export function geminiTidyModel({ apiKey, model = "gemini-3.8-flash" }: GeminiTidyOptions): TidyModel {
  const ai = new GoogleGenAI({ apiKey });
  return async ({ raw, wiki, signal }) => {
    const block = (title: string, notes: { path: string; content: string }[]) =>
      `## ${title}\n\n` + (notes.length ? notes.map((n) => `<note path="${n.path}">\n${n.content.trim()}\n</note>`).join("\n\n") : "(none)");
    const response = await ai.models.generateContent({
      model,
      contents: `${block("New raw notes", raw)}\n\n${block("Current wiki pages", wiki)}`,
      config: {
        systemInstruction: INSTRUCTIONS,
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
        abortSignal: signal,
      },
    });
    const text = response.text;
    if (!text) throw new Error("the tidy model gave no answer");
    const { pages } = JSON.parse(text) as { pages?: WikiPage[] };
    if (!Array.isArray(pages)) throw new Error("the tidy model's answer had no pages list");
    return pages;
  };
}
