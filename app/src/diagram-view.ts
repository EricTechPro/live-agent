// The diagram panel (ticket 16): draws the core's `diagram` events with Mermaid.
// Renders only. Mermaid ships inside the app's build (no CDN) and loads on the
// first diagram, so the window starts as fast as before. Bad source from the
// model shows as an error in the panel; it never breaks the window.
import type { CoreClient } from "./core-client.ts";
import { addDiagramEvent, noDiagram, type Diagram } from "./diagram.ts";

type Mermaid = typeof import("mermaid").default;
let mermaid: Promise<Mermaid> | undefined;

function loadMermaid(): Promise<Mermaid> {
  mermaid ??= import("mermaid").then(({ default: m }) => {
    // strict: no scripts or click handlers from model-written source.
    m.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict", suppressErrorRendering: true });
    return m;
  });
  return mermaid;
}

export function mountDiagram(core: CoreClient, panel: HTMLElement) {
  let diagram: Diagram = noDiagram;
  const title = Object.assign(document.createElement("h2"), { className: "diagram-title" });
  // No close button of its own: it lives in the right panel's Canvas tab, which has the X (ticket 25).
  const body = Object.assign(document.createElement("div"), { className: "diagram-body" });
  const head = Object.assign(document.createElement("div"), { className: "diagram-head" });
  head.append(title);
  panel.append(head, body);

  // Each render gets a number, so a slow render never paints over a newer diagram.
  let renders = 0;

  async function render(d: NonNullable<Diagram>) {
    const n = ++renders;
    panel.hidden = false;
    title.textContent = d.title ?? "Diagram";
    body.replaceChildren(Object.assign(document.createElement("p"), { className: "diagram-note", textContent: "Drawing…" }));
    try {
      const m = await loadMermaid();
      const { svg } = await m.render(`diagram-${n}`, d.source);
      if (n === renders) body.innerHTML = svg;
    } catch (err) {
      if (n !== renders) return;
      const message = err instanceof Error ? err.message : String(err);
      body.replaceChildren(
        Object.assign(document.createElement("p"), { className: "diagram-error", textContent: `Could not draw this diagram: ${message}` }),
        Object.assign(document.createElement("pre"), { className: "diagram-source", textContent: d.source }),
      );
    }
  }

  core.onEvent((event) => {
    const next = addDiagramEvent(diagram, event);
    if (next === diagram) return;
    diagram = next;
    if (diagram) render(diagram);
    else {
      renders++;
      panel.hidden = true;
      body.replaceChildren();
    }
  });
}
