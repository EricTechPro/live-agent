// Diagram cards on the sketch canvas (ticket 35): the Mermaid SVG inside each
// `diagram` mark's pen-drawn frame. The frame and title are canvas ink
// (sketch.ts inkFor); this layer only holds the diagrams, positioned by cardBox.
//
// Mermaid ships inside the app's build (no CDN) and loads on the first card, so
// the window starts as fast as before. `securityLevel: "strict"`: no scripts or
// click handlers from model-written source. A parse error shows in the card,
// with the source under it; it never breaks the window.
import { cardBox, diagramCards, type DiagramMark, type Scene } from "./sketch.ts";

type Mermaid = typeof import("mermaid").default;
let mermaid: Promise<Mermaid> | undefined;

function loadMermaid(): Promise<Mermaid> {
  mermaid ??= import("mermaid").then(({ default: m }) => {
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "base",
      // Ink on the dark teal board, like the pen.
      themeVariables: {
        darkMode: true,
        background: "transparent",
        primaryColor: "#0a2a2c",
        primaryTextColor: "#e8fffa",
        primaryBorderColor: "#7fe9d3",
        secondaryColor: "#0d3236",
        tertiaryColor: "#0d3236",
        lineColor: "#e8fffa",
        textColor: "#e8fffa",
        edgeLabelBackground: "#041416",
        fontFamily: '"Martian Mono", ui-monospace, monospace',
        fontSize: "14px",
      },
    });
    return m;
  });
  return mermaid;
}

interface Card {
  el: HTMLDivElement;
  source: string;
  render: number;
}

let renders = 0;

export function mountCards(board: HTMLElement) {
  const layer = Object.assign(document.createElement("div"), { className: "sketch-cards" });
  board.append(layer);
  const cards = new Map<string, Card>();

  async function render(card: Card, source: string) {
    const n = (card.render = ++renders);
    card.el.dataset.state = "drawing";
    card.el.replaceChildren(Object.assign(document.createElement("p"), { className: "sketch-card-note", textContent: "Drawing…" }));
    try {
      const m = await loadMermaid();
      const { svg } = await m.render(`jett-card-${n}`, source);
      if (n !== card.render) return;
      card.el.innerHTML = svg;
      card.el.dataset.state = "ok";
    } catch (err) {
      if (n !== card.render) return;
      const message = err instanceof Error ? err.message : String(err);
      card.el.dataset.state = "error";
      card.el.replaceChildren(
        Object.assign(document.createElement("p"), { className: "sketch-card-error", textContent: `Could not draw this diagram: ${message}` }),
        Object.assign(document.createElement("pre"), { className: "sketch-card-source", textContent: source }),
      );
    }
  }

  return {
    /** Match the layer to the scene: new cards render, changed sources re-render, erased cards go. */
    sync(scene: Scene, fit: { scale: number; x: number; y: number }, framed: (id: string) => boolean) {
      const live = new Set<string>();
      for (const mark of diagramCards(scene)) {
        live.add(mark.id);
        let card = cards.get(mark.id);
        if (!card) {
          const el = Object.assign(document.createElement("div"), { className: "sketch-card" });
          el.setAttribute("role", "img");
          layer.append(el);
          card = { el, source: "", render: 0 };
          cards.set(mark.id, card);
        }
        if (card.source !== mark.source) {
          card.source = mark.source;
          void render(card, mark.source);
        }
        place(card.el, mark, fit);
        // The diagram fades in once the pen has drawn its frame.
        card.el.dataset.shown = String(framed(mark.id));
      }
      for (const [id, card] of cards) {
        if (live.has(id)) continue;
        cards.delete(id);
        card.render = -1;
        card.el.dataset.shown = "false";
        setTimeout(() => card.el.remove(), 500);
      }
    },
  };
}

function place(el: HTMLElement, mark: DiagramMark, fit: { scale: number; x: number; y: number }) {
  const box = cardBox(mark, fit);
  el.style.left = `${box.left}px`;
  el.style.top = `${box.top}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
  el.setAttribute("aria-label", mark.title ? `Diagram: ${mark.title}` : "Diagram");
}
