// show_image: a real picture in a card (an `image` card on the canvas).
//
// mode find: a photo of a real thing from Wikimedia Commons, with its author and license.
// mode generate: a picture made by a Gemini image model, captioned "generated".
// The card opens at once with a loading note; the picture fills it when it lands
// (a canvas.edit), so Jett keeps talking meanwhile (every tool runs NON_BLOCKING).
// The bytes go to the window as a data: URL, never to the model.
// Risk class "read": it changes nothing on disk.
import type { Mark } from "../src/core/canvas.ts";
import { defineTool } from "../src/core/tool.ts";

type Mode = "find" | "generate";

export default defineTool<{ mode: Mode; query: string; title?: string }>({
  name: "show_image",
  description:
    "Show a real picture in a card on the user's screen. " +
    "mode find: a photo of a real thing (an animal cell, the Eiffel Tower, a red panda), from Wikimedia Commons. " +
    "mode generate: make a new picture of something imaginary or stylized ('draw me a dragon', 'a cartoon cell'). " +
    "The card opens at once and the picture fills it in a few seconds; keep talking meanwhile. " +
    "For flows, plans and structures use draw instead.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["find", "generate"], description: "find: a real photo. generate: make a new picture." },
      query: {
        type: "string",
        description: "find: a few search words in English, e.g. 'animal cell'. generate: a full description of the picture to make.",
      },
      title: { type: "string", description: "The card's title, one to three words." },
    },
    required: ["mode", "query"],
  },
  async run({ mode, query, title }, { canvas, images }) {
    if (!images) throw new Error("Pictures are not available here.");
    if (mode !== "find" && mode !== "generate") throw new Error("mode is find or generate");
    const what = String(query ?? "").trim();
    if (!what) throw new Error("query is empty: say what picture to show");
    const name = (title?.trim() || what).slice(0, 40);

    // The first free id, so later turns can circle or erase it like any card.
    const taken = new Set(canvas.ids());
    let n = 1;
    while (taken.has(`p${n}`)) n++;
    const card = { kind: "image", id: `p${n}`, title: name } as Extract<Mark, { kind: "image" }>;
    canvas.draw([{ say: name, marks: [card] }]);

    try {
      const pic = mode === "find" ? await images.find(what) : await images.generate(what);
      const caption = mode === "generate" ? "generated" : pic.name?.slice(0, 120);
      const shown = canvas.replace({ ...card, src: pic.src, ...(caption ? { caption } : {}), credit: pic.credit });
      return { shown, id: card.id, title: name, ...(caption ? { caption } : {}), credit: pic.credit };
    } catch (err) {
      // No picture: the loading card goes, and the voice says the one line.
      if (canvas.ids().includes(card.id)) canvas.change({ edits: [], erase: [card.id] });
      throw err;
    }
  },
});
