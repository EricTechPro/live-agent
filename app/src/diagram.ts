// The diagram panel's state, built from the core's `diagram` events. Pure, like
// transcript.ts: the latest diagram wins, and a new chat clears it.
import type { AgentEvent, EventOf } from "../../src/core/events.ts";

export type Diagram = Omit<EventOf<"diagram">, "type"> | null;

export const noDiagram: Diagram = null;

export function addDiagramEvent(diagram: Diagram, event: AgentEvent): Diagram {
  if (event.type === "chat.started") return noDiagram;
  if (event.type !== "diagram") return diagram;
  const { type: _type, ...next } = event;
  return next;
}
