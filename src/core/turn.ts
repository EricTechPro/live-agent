// A turn: one exchange in the conversation, from what the user said (typed or
// spoken) to the model being done answering it.
//
// Why only one at a time: a live conversation takes turns, so the core does
// too. A turn ends when the model has answered everything we sent it
// (`awaiting`) and no tool is still running (`running`). Tools are
// NON_BLOCKING, so the model may finish speaking ("let me look...") before a
// tool's answer lands; the turn stays open until that answer has been spoken.
import type { AgentEvent } from "./events.ts";
import type { ModelEvent } from "./model.ts";

/** A tool call as the model makes it. */
export type ToolCall = Extract<ModelEvent, { type: "tool.call" }>;

export interface Turn {
  /** Every event of this turn, in order: what `sendText` resolves with. */
  events: AgentEvent[];
  /** The model's reply so far (its text arrives in chunks). */
  reply: string;
  /** Inputs the model still owes an answer to (our text, non-silent tool answers). */
  awaiting: number;
  /** Tools started in this turn that have not answered yet. */
  running: number;
  /** Brain notes this turn's answer used (reported once, at the end). */
  notes: Set<string>;
  /** What the user said in a voice turn (its transcription arrives in pieces). */
  heard: string;
  /** Tells whoever started the turn that it is over. */
  done: (events: AgentEvent[]) => void;
}

/** A fresh turn. `done` is how its sender (e.g. `sendText`) hears it ended. */
export function newTurn(done: (events: AgentEvent[]) => void = () => {}): Turn {
  return { events: [], reply: "", awaiting: 0, running: 0, notes: new Set(), heard: "", done };
}

/** True once the model owes nothing more and no tool of this turn is still running. */
export function turnIsOver(turn: Turn): boolean {
  return turn.awaiting <= 0 && turn.running <= 0;
}
