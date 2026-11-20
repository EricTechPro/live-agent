// The chat's canvas, core side (tickets 31, 33, 34): the marks on it, by id.
//
//   const board = createBoard(emit);
//   board.draw(callId, beats);        // canvas.beat per beat; throws if an id is taken by another kind
//                                     // a card that repeats one on the board updates it (canvas.edit)
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
  /**
   * Draw the beats. A card that repeats one already on the board (same id and kind, a model of
   * the same shape, or a card of the same kind and title) updates that card instead of adding a
   * near-copy: a `canvas.edit` right after its beat, and ink on it follows it. `merged` names those.
   */
  draw(callId: string, beats: Beat[]): { merged: { from: string; into: string }[] };
  /** Edits first, then erases. Throws (and changes nothing) on an unknown id or a bad edit. */
  change(callId: string, change: CanvasChange): { edited: string[]; erased: string[] };
  /**
   * Swap a mark on the canvas for a new one (same id): a `canvas.edit`. A picture that
   * finished loading fills its card this way. False (and nothing emitted) when the id is
   * gone: erased, or a new chat cleared the board while it loaded.
   */
  replace(callId: string, mark: Mark): boolean;
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

const titleOf = (m: Mark) => ((m as { title?: string }).title ?? "").trim().toLowerCase();

/**
 * The card on the board `m` repeats, if any (feedback: a black hole came out as three model
 * cards, sphere, sphere, disk, when it was one thing built up). Pictures never merge. A model of
 * the same shape merges only within one answer (`thisTurn`): Earth and Mars stay two cards.
 */
function twinOf(m: Mark, board: Map<string, Mark>, thisTurn: Set<string>): Mark | undefined {
  if (!isCard(m) || m.kind === "image") return undefined;
  const same = board.get(m.id);
  if (same) return same.kind === m.kind ? same : undefined;
  for (const o of board.values()) {
    if (o.kind !== m.kind) continue;
    if (m.kind === "model" && thisTurn.has(o.id) && (o as { shape?: string }).shape === (m as { shape?: string }).shape) return o;
    if (titleOf(m) && titleOf(m) === titleOf(o)) return o;
  }
  return undefined;
}

/** How many of a line's first words must be heard to call it started. */
const LEAD_WORDS = 3;

export function createBoard(emit: (event: AgentEvent) => void): Board {
  const marks = new Map<string, Mark>();
  // Beats drawn but not yet spoken (ticket 34), in order, and the words heard since.
  type Pending = { callId: string; beat: number; lead: string; ids: string[] };
  let pending: Pending[] = [];
  let heard = "";
  // Cards drawn in this answer (turn): a same-shape model among them is a step of one build-up.
  const thisTurn = new Set<string>();
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
      // Repeats of a card on the board (or earlier in this call) become updates of it.
      const seen = new Map(marks);
      const rename = new Map<string, string>();
      const merged: { from: string; into: string }[] = [];
      const turnNow = new Set(thisTurn);
      const plan = beats.map(({ say, marks: drawn }) => {
        const add: Mark[] = [];
        const update: Mark[] = [];
        for (const raw of drawn) {
          const r = raw as { on?: string; to_card?: string };
          const on = r.on && rename.get(r.on), to = r.to_card && rename.get(r.to_card);
          const m = (on || to ? { ...raw, ...(on ? { on } : {}), ...(to ? { to_card: to } : {}) } : raw) as Mark;
          const twin = twinOf(m, seen, turnNow);
          if (twin) {
            const next = { ...m, id: twin.id, title: (m as { title?: string }).title ?? (twin as { title?: string }).title } as Mark;
            rename.set(m.id, twin.id);
            if (m.id !== twin.id) merged.push({ from: m.id, into: twin.id });
            seen.set(twin.id, next);
            update.push(next);
          } else {
            add.push(m);
            if (!marks.has(m.id)) {
              seen.set(m.id, m);
              turnNow.add(m.id);
            }
          }
        }
        return { say, add, update };
      });
      const ids = plan.flatMap((b) => b.add.map((m) => m.id));
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
      for (const b of plan)
        for (const m of [...b.update, ...b.add]) {
          if (isCard(m)) cards.add(m.id);
          const r = m as { on?: string; to_card?: string };
          for (const ref of [r.on, r.to_card]) if (ref && !cards.has(ref)) missing.push(`${m.id} is on ${ref}, which is not a card drawn before it`);
        }
      if (missing.length) throw new Error(`Nothing was drawn. ${missing.slice(0, 3).join("; ")}.`);
      if (!pending.length) heard = "";
      plan.forEach(({ say, add, update }, beat) => {
        for (const m of add) {
          marks.set(m.id, m);
          thisTurn.add(m.id);
        }
        emit({ type: "canvas.beat", id: callId, beat, say, marks: add });
        for (const m of update) {
          marks.set(m.id, m);
          emit({ type: "canvas.edit", id: callId, change: {}, mark: m });
        }
        const lead = words(say).slice(0, LEAD_WORDS).join(" ");
        // Only new marks: an interrupted update must not erase the card it changed.
        if (lead) pending.push({ callId, beat, lead, ids: add.map((m) => m.id) });
      });
      return { merged };
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

    replace(callId, mark) {
      if (!marks.has(mark.id)) return false;
      marks.set(mark.id, mark);
      emit({ type: "canvas.edit", id: callId, change: {}, mark });
      return true;
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

    turnDone() {
      forgetSpeech();
      thisTurn.clear();
    },

    clear() {
      marks.clear();
      thisTurn.clear();
      forgetSpeech();
    },
  };
}
