// Approvals: tool calls the safety gate said "ask" about, waiting for a yes.
//
//   const approvals = createApprovals({ approve, decline });
//   approvals.ask(call);              // the gate said "ask"
//   approvals.openTurn();             // the user's next turn begins: it answers them
//   approvals.hear("yes, go ahead");  // a yes runs them (true), anything else keeps listening
//   approvals.closeTurn(true);        // the turn is over: the user spoke but said no yes -> declined
//   approvals.answer("c1", true);     // the window's approve / deny card (ticket 28): one call by id
//
// Why "hear" can be called many times: a spoken answer arrives in pieces
// ("Yes, " then "go ahead."), so the core feeds it the words so far. A typed
// answer is one piece. Both go through this same path, so typed and spoken
// yes behave the same.
//
// Why a turn with no words leaves the calls waiting: the model also opens a
// turn on its own (announcing a finished job), and that is not the user's
// answer.
import type { ToolCall } from "./turn.ts";

// What counts as "yes". Anything else declines.
const YES = /^\s*(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please do|approved?)\b/i;

export interface Approvals {
  /** The gate said "ask": this call waits for the user's next turn. */
  ask(call: ToolCall): void;
  /** A turn begins: every call waiting now is answered by this turn's words. */
  openTurn(): void;
  /** The user's words in this turn so far. A yes approves the calls at once; returns true then. */
  hear(words: string): boolean;
  /** The turn is over. If the user spoke without a yes, the calls are declined; else they keep waiting. */
  closeTurn(userSpoke: boolean, reason?: string): void;
  /**
   * The window's card answered one call by id: yes runs it, no declines it (and
   * the model is told at once, so it says so). False if no call with that id is
   * waiting (unknown, or already answered by voice, text or an earlier click).
   */
  answer(id: string, yes: boolean): boolean;
  /** The model took a call back: forget it. Returns it, if it was waiting. */
  drop(id: string): ToolCall | undefined;
  /** Forget every waiting call (the model is on a new connection). Returns them. */
  dropAll(): ToolCall[];
}

export interface ApprovalActions {
  /** Run these calls: the user said yes (`reason` goes on the allow verdict). */
  approve(calls: ToolCall[], reason?: string): void;
  /**
   * Tell the model these calls will not run. `speak`: the model answers it on its
   * own (a click has no words of the user's to answer together with).
   */
  decline(calls: ToolCall[], reason: string, speak?: boolean): void;
}

export function createApprovals({ approve, decline }: ApprovalActions): Approvals {
  // Waiting for the user's next turn.
  let waiting: ToolCall[] = [];
  // Taken by the turn in flight: its words decide them.
  let answering: ToolCall[] = [];

  return {
    ask(call) {
      waiting.push(call);
    },
    openTurn() {
      answering.push(...waiting.splice(0));
    },
    hear(words) {
      if (!answering.length || !YES.test(words)) return false;
      approve(answering.splice(0));
      return true;
    },
    closeTurn(userSpoke, reason = "the user did not say yes") {
      const unanswered = answering.splice(0);
      if (userSpoke) decline(unanswered, reason);
      else waiting.unshift(...unanswered);
    },
    answer(id, yes) {
      const call = [...waiting, ...answering].find((c) => c.id === id);
      if (!call) return false;
      waiting = waiting.filter((c) => c.id !== id);
      answering = answering.filter((c) => c.id !== id);
      if (yes) approve([call], "the user approved in the window");
      else decline([call], "the user declined in the window", true);
      return true;
    },
    drop(id) {
      const call = [...waiting, ...answering].find((c) => c.id === id);
      waiting = waiting.filter((c) => c.id !== id);
      answering = answering.filter((c) => c.id !== id);
      return call;
    },
    dropAll() {
      return [...waiting.splice(0), ...answering.splice(0)];
    },
  };
}
