// The real tidy model: one Gemini text call (not Live) that turns raw notes into wiki pages.
//
//   startSession({ model, tidy: geminiTidyModel({ apiKey }) });
//
// It only returns pages; src/brain/tidy.ts checks the paths and writes them.
// Structured JSON output, so the answer is always `{ pages: [{ path, content }] }`.
import { GoogleGenAI } from "@google/genai";
import type { TidyModel, WikiPage } from "../brain/tidy.ts";

export interface GeminiTidyOptions {
  apiKey: string;
  /** A Gemini text model. Default "gemini-3.8-flash". */
  model?: string;
}

const INSTRUCTIONS = `You keep a personal wiki tidy, Karpathy-style: raw notes in, clean wiki pages out.
You get NEW raw notes (quick, messy notes and chat summaries) and the CURRENT wiki pages.
Fold every fact from the raw notes into the wiki:
- One topic per page (a person, a thing, a place, a plan). Prefer updating an existing page over a new one.
- When you update a page, return its WHOLE new content, keeping everything that was already there.
- New pages: path "wiki/<lowercase-words-with-dashes>.md", content starting with "# Title".
- Plain markdown, short sentences and bullet points. Only facts the notes state; never invent anything.
- Skip small talk and anything with no lasting fact. Return only pages you created or changed (an empty list is fine).`;

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
