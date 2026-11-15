// The approve / deny cards above the composer (ticket 28, window half). Renders
// only: core events in (through approvals.ts), approve / decline out. A card leaves
// when the core says the call was answered, however it was answered. Nothing is
// focused when a card appears, so a stray Enter never approves anything.
import { addApprovalEvent, noApprovals, type Approvals, type Card } from "./approvals.ts";
import type { CoreClient } from "./core-client.ts";
import { iconSvg } from "./icons.ts";

export function mountApprovals(core: CoreClient, list: HTMLElement) {
  let state: Approvals = noApprovals;
  /** Cards the user already clicked: gone from screen even before the core's answer arrives. */
  const answered = new Set<string>();

  function button(card: Card, approve: boolean) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `pf ib answer ${approve ? "approve" : "deny"}`;
    const label = approve ? `Approve: ${card.what}` : `Deny: ${card.what}`;
    b.setAttribute("aria-label", label);
    b.dataset.tip = approve ? "Approve" : "Deny";
    b.innerHTML = iconSvg(approve ? "check" : "close", 18);
    b.onclick = () => {
      answered.add(card.id);
      render();
      // Already answered (by voice, or a double click): the core refuses, and nothing happens.
      core.answerCall(card.id, approve).catch(() => {});
    };
    return b;
  }

  function render() {
    const cards = state.cards.filter((c) => !answered.has(c.id));
    list.hidden = cards.length === 0;
    list.replaceChildren(
      ...cards.map((card) => {
        const li = document.createElement("li");
        li.className = "pf approval";
        li.dataset.id = card.id;
        const text = document.createElement("p");
        text.className = "approval-text";
        text.append(Object.assign(document.createElement("b"), { textContent: "May I?" }), " ", card.what);
        li.append(text, button(card, false), button(card, true));
        return li;
      }),
    );
  }

  core.onEvent((event) => {
    const next = addApprovalEvent(state, event);
    if (next.cards === state.cards) return void (state = next);
    state = next;
    for (const id of answered) if (!state.cards.some((c) => c.id === id)) answered.delete(id);
    render();
  });
  render();
}
