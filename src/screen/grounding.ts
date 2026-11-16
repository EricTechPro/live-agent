// The locator's last tier (src/screen/locator.ts): one Gemini Flash call that finds a UI
// element on a fresh screenshot and answers its box on the 0-1000 grid, [ymin, xmin, ymax, xmax].
// Not Gemini Live: Live's frames are small and it is tuned for talk, not exact boxes.
//
//   createLocator({ eyes, ground: geminiGround({ apiKey }) })
import { GoogleGenAI } from "@google/genai";
import type { Ground } from "./locator.ts";

export interface GeminiGroundOptions {
  apiKey: string;
  /** A Gemini vision model. Default "gemini-3.8-flash" (the tidy model). */
  model?: string;
  timeoutMs?: number;
}

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean", description: "false when the element is not visible in the image" },
    box_2d: { type: "array", items: { type: "number" }, description: "[ymin, xmin, ymax, xmax], each 0 to 1000" },
    label: { type: "string", description: "the element's visible words, if any" },
  },
  required: ["found"],
};

/** Parse the model's answer; anything odd is "not found" (never a guess). */
export function parseGround(text: string | undefined): { box: [number, number, number, number]; label?: string } | null {
  if (!text) return null;
  try {
    const a = JSON.parse(text) as { found?: boolean; box_2d?: unknown; label?: string };
    const b = a.box_2d;
    if (!a.found || !Array.isArray(b) || b.length !== 4 || !b.every((v) => typeof v === "number" && v >= 0 && v <= 1000)) return null;
    const [y0, x0, y1, x1] = b as number[];
    if (y1! <= y0! || x1! <= x0!) return null;
    return { box: [y0!, x0!, y1!, x1!], label: a.label || undefined };
  } catch {
    return null;
  }
}

export function geminiGround({ apiKey, model = "gemini-3.8-flash", timeoutMs = 12_000 }: GeminiGroundOptions): Ground {
  const ai = new GoogleGenAI({ apiKey });
  return async (shot, describe) => {
    const signal = AbortSignal.timeout(timeoutMs);
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: Buffer.from(shot.jpeg).toString("base64") } },
            {
              text:
                `This is a screenshot of part of a computer screen. Find this one UI element: ${describe}. ` +
                "Answer its tight bounding box as box_2d [ymin, xmin, ymax, xmax] on a 0-1000 grid of the image. " +
                "If it is not clearly visible, answer found=false. Never guess.",
            },
          ],
        },
      ],
      config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0, abortSignal: signal },
    });
    return parseGround(response.text);
  };
}
