// The chat's canvas, core side (tickets 31, 33, 34): the marks on it, by id.
//
//   const board = createBoard(emit);
//   board.draw(callId, beats);        // canvas.beat per beat; throws if an id is taken
//   board.change(callId, { edits, erase });  // canvas.edit per edit, then canvas.erase ("all" clears)
//   board.heard(text);                // the model's words: canvas.speak as each beat's line starts
//   board.interrupted();              // the user talked over it: unspoken beats are erased
//   board.turnDone();                 // lines not said by now never get a signal
//   board.clear();                    // a new chat: a clean board, no event
//
// Why the core keeps the marks (not only their ids): an edit is checked here
// against the real mark (a label on a check, a move off the board), so a bad
// call is a tool error the model hears and the window only ever gets good marks.
// Every call checks everything first and then emits, so a refused call changes nothing.
//
// Why speak signals come from the transcript: it is the one timing signal the
// core already has for the voice (Gemini Live's output transcription arrives
// as the words are spoken). A line counts as started once its first few words
// are heard. The window paces the pen to these signals (app/src/pen.ts).
import { applyEdit, isCard, type Beat, type Mark, type MarkChange, type MarkEdit } from "./canvas.ts";
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
  /** A chunk of the model's spoken reply (its output transcript). */
  heard(text: string): void;
  interrupted(): void;
  turnDone(): void;
  clear(): void;
}

/** Lowercase words only, so "THEN, it" matches "then it". */
export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/** How many of a line's first words must be heard to call it started. */
const LEAD_WORDS = 3;

export function createBoard(emit: (event: AgentEvent) => void): Board {
  const marks = new Map<string, Mark>();
  // Beats drawn but not yet spoken (ticket 34), in order, and the words heard since.
  type Pending = { callId: string; beat: number; lead: string; ids: string[] };
  let pending: Pending[] = [];
  let heard = "";
  const forgetSpeech = () => {
    pending = [];
    heard = "";
  };

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
      // Ink placed on a card needs that card: drawn earlier in this call or already on the canvas.
      const cards = new Set([...marks.values()].filter(isCard).map((m) => m.id));
      const missing: string[] = [];
      for (const b of beats)
        for (const m of b.marks) {
          if (isCard(m)) cards.add(m.id);
          const r = m as { on?: string; to_card?: string };
          for (const ref of [r.on, r.to_card]) if (ref && !cards.has(ref)) missing.push(`${m.id} is on ${ref}, which is not a card drawn before it`);
        }
      if (missing.length) throw new Error(`Nothing was drawn. ${missing.slice(0, 3).join("; ")}.`);
      for (const b of beats) for (const m of b.marks) marks.set(m.id, m);
      beats.forEach(({ say, marks: drawn }, beat) => emit({ type: "canvas.beat", id: callId, beat, say, marks: drawn }));
      if (!pending.length) heard = "";
      beats.forEach(({ say, marks: drawn }, beat) => {
        const lead = words(say).slice(0, LEAD_WORDS).join(" ");
        if (lead) pending.push({ callId, beat, lead, ids: drawn.map((m) => m.id) });
      });
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

    heard(text) {
      if (!pending.length) return;
      heard += ` ${text}`;
      const said = ` ${words(heard).join(" ")} `;
      // The latest line whose start was heard. Lines before it count as spoken too
      // (the voice skipped or reworded them), so the signals always come in order.
      let last = -1;
      pending.forEach((p, i) => {
        if (said.includes(` ${p.lead} `)) last = i;
      });
      if (last < 0) return;
      const lead = pending[last]!.lead;
      for (const p of pending.splice(0, last + 1)) emit({ type: "canvas.speak", id: p.callId, beat: p.beat });
      // Keep only the words after that line's start, so a later line never matches older words.
      heard = said.slice(said.lastIndexOf(` ${lead} `) + lead.length + 1);
    },

    interrupted() {
      // Never spoken, so never drawn: off the canvas, and their ids are free again.
      const byCall = new Map<string, string[]>();
      for (const p of pending) {
        const ids = p.ids.filter((id) => marks.has(id));
        for (const id of ids) marks.delete(id);
        if (ids.length) byCall.set(p.callId, [...(byCall.get(p.callId) ?? []), ...ids]);
      }
      forgetSpeech();
      for (const [callId, ids] of byCall) emit({ type: "canvas.erase", id: callId, ids, all: false });
    },

    turnDone: forgetSpeech,

    clear() {
      marks.clear();
      forgetSpeech();
    },
  };
}
