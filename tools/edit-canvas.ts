// edit_canvas: change what `draw` put on the canvas, by mark id (ticket 33).
//
// "Make p2 red", "move p3 down" (dy), "move it to the right" (dx), "rename p1", "erase p3", "clear the board".
// The core keeps the chat's marks (src/core/board.ts), so an unknown id or a
// change that does not fit the mark is a tool error the model hears, and the
// whole call changes nothing. Risk class "read": nothing on disk changes.
import { COLORS, MODEL_SHAPES, parseEdits } from "../src/core/canvas.ts";
import { defineTool } from "../src/core/tool.ts";

export default defineTool<{ edits?: unknown; erase?: unknown }>({
  name: "edit_canvas",
  description:
    "Change marks already on the user's canvas, by their ids (p1, p2, ... from draw's result). " +
    "Use it when the user says things like 'make p2 red', 'move that box down', 'erase p3' or 'clear the board'. " +
    'Send edits (id plus color, label, a new x / y, or dx / dy to move it by that much) and / or erase (ids, or ["all"] to clear the board). ' +
    "To build up a 3D model card step by step, change its shape (a ball, then shape planet to add the disk) and labels here, never draw a second model. " +
    "Say one short line about the change; do not read ids out loud unless the user used them.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        description: "Changes to marks, applied in order.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The mark to change, e.g. p2." },
            color: { type: "string", enum: [...COLORS], description: "New pen colour." },
            label: { type: "string", description: "New words: a text mark's text, or the label of a box, arrow or step." },
            x: { type: "number", description: "Move: new x of the mark's corner (box), centre, or start (arrow, line). 0 to 1000." },
            y: { type: "number", description: "Move: new y, like x. 0 to 600." },
            dx: { type: "number", description: "Move by: board units right (negative: left), -1000 to 1000. Use for 'move it right a bit' (about 50). Not with x." },
            dy: { type: "number", description: "Move by: board units down (negative: up), -1000 to 1000. Use for 'move p3 down' (about 50). Not with y." },
            shape: { type: "string", enum: [...MODEL_SHAPES], description: "Model cards: the new 3D shape (e.g. sphere -> planet to add a ring or disk)." },
            labels: {
              type: "array",
              description: "Model cards: up to 4 labels pinned at x, y, z (-1 to 1); replaces the old labels.",
              items: { type: "object", properties: { text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, z: { type: "number" } }, required: ["text", "x", "y", "z"] },
            },
          },
          required: ["id"],
        },
      },
      erase: {
        type: "array",
        items: { type: "string" },
        description: 'Ids to erase, e.g. ["p3"]. ["all"] clears the whole board.',
      },
    },
  },
  run(args, { canvas }) {
    const { edited, erased } = canvas.change(parseEdits(args));
    return { edited, erased, canvas: canvas.ids() };
  },
});
