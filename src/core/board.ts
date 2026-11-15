// The chat's canvas, core side (tickets 31, 33): the marks on it, by id.
//
//   const board = createBoard(emit);
//   board.draw(callId, beats);        // canvas.beat per beat; throws if an id is taken
//   board.change(callId, { edits, erase });  // canvas.edit per edit, then canvas.erase ("all" clears)
//   board.clear();                    // a new chat: a clean board, no event
//
// Why the core keeps the marks (not only their ids): an edit is checked here
// against the real mark (a label on a check, a move off the board), so a bad
// call is a tool error the model hears and the window only ever gets good marks.
// Every call checks everything first and then emits, so a refused call changes nothing.
import { applyEdit, type Beat, type Mark, type MarkChange, type MarkEdit } from "./canvas.ts";
import type { AgentEvent } from "./events.ts";

export interface CanvasChange {
  edits: MarkEdit[];
  /** Ids to erase, or "all". */
  erase: string[] | "all";
}

export interface Board {
  /** The ids on the canvas now, in drawing order. */
  ids(): string[];
  draw(callId: string, beats: Beat[]): void;
  /** Edits first, then erases. Throws (and changes nothing) on an unknown id or a bad edit. */
  change(callId: string, change: CanvasChange): { edited: string[]; erased: string[] };
  clear(): void;
}

export function createBoard(emit: (event: AgentEvent) => void): Board {
  const marks = new Map<string, Mark>();

  const has = () => (marks.size ? `it has ${[...marks.keys()].join(", ")}` : "it is empty");
  function known(ids: string[]) {
    const unknown = ids.filter((id) => !marks.has(id));
    if (unknown.length) {
      throw new Error(`Nothing was changed. ${unknown.join(", ")} ${unknown.length > 1 ? "are" : "is"} not on the canvas (${has()}).`);
    }
  }

  return {
    ids: () => [...marks.keys()],

    draw(callId, beats) {
      const ids = beats.flatMap((b) => b.marks.map((m) => m.id));
      const taken = ids.filter((id) => marks.has(id));
      if (taken.length) {
        throw new Error(
          `Nothing was drawn. ${taken.join(", ")} ${taken.length > 1 ? "are" : "is"} already on the canvas: use new ids ` +
            `(the canvas has ${[...marks.keys()].join(", ")}).`,
        );
      }
      for (const b of beats) for (const m of b.marks) marks.set(m.id, m);
      beats.forEach(({ say, marks: drawn }, beat) => emit({ type: "canvas.beat", id: callId, beat, say, marks: drawn }));
    },

    change(callId, { edits, erase }) {
      // Check it all first: one bad edit or unknown id keeps the whole call out.
      known(edits.map((e) => e.id));
      if (erase !== "all") known(erase);
      // Apply on a copy: edits may build on each other.
      const next = new Map(marks);
      const changed: { mark: Mark; change: MarkChange }[] = [];
      for (const { id, ...change } of edits) {
        const mark = applyEdit(next.get(id)!, change);
        next.set(id, mark);
        changed.push({ mark, change });
      }
      for (const { mark, change } of changed) {
        marks.set(mark.id, mark);
        emit({ type: "canvas.edit", id: callId, change, mark });
      }
      const all = erase === "all";
      const erased = all ? [...marks.keys()] : [...new Set(erase)];
      for (const id of erased) marks.delete(id);
      if (erased.length || all) emit({ type: "canvas.erase", id: callId, ids: erased, all });
      return { edited: changed.map((c) => c.mark.id), erased };
    },

    clear: () => marks.clear(),
  };
}
