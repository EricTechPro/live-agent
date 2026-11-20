// "What I remember" in the popover's Brain tab (gap #7): one row per fact `remember`
// saved, each with a Forget link (POST /memory/forget). It follows `memory` events.
import type { Fact } from "../../src/brain/memory.ts";
import type { CoreClient } from "./core-client.ts";

export function mountMemoryView(core: CoreClient, els: { list: HTMLUListElement; empty: HTMLElement; count: HTMLElement }) {
  let facts: Fact[] = [];
  function render() {
    els.empty.hidden = facts.length > 0;
    els.count.textContent = facts.length ? String(facts.length) : "";
    els.list.replaceChildren(
      ...[...facts].reverse().map((fact) => {
        const li = Object.assign(document.createElement("li"), { className: "mem-row" });
        const text = Object.assign(document.createElement("span"), { className: "mem-text", textContent: fact.text, title: fact.text });
        const forget = Object.assign(document.createElement("button"), { type: "button", className: "mem-forget", textContent: "Forget" });
        forget.setAttribute("aria-label", `Forget: ${fact.text}`);
        forget.onclick = () => {
          forget.disabled = true;
          core.forget(fact.id).then((left) => ((facts = left), render()), () => (forget.disabled = false));
        };
        li.append(text, forget);
        return li;
      }),
    );
  }
  void core.memory().then((f) => ((facts = f), render()), () => render());
  core.onEvent((event) => {
    if (event.type === "memory") (facts = event.facts), render();
  });
}
