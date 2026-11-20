// Diagram cards (ticket 35, drawing v2): the Mermaid SVG inside each `diagram`
// card. The card's chrome and title are canvas (sketch-view.ts); this layer only
// holds the diagrams, at the body box layout.ts gives the card. Styled like the
// pen: teal lines on dark glass, Martian Mono, square corners.
//
// Mermaid ships inside the app's build (no CDN) and loads on the first card, so
// the window starts as fast as before. `securityLevel: "strict"`: no scripts or
// click handlers from model-written source. A parse error shows in the card,
// with the source under it; it never breaks the window.

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
      flowchart: { curve: "basis", padding: 10, nodeSpacing: 34, rankSpacing: 40 },
      themeVariables: {
        darkMode: true,
        background: "transparent",
        primaryColor: "#06201f",
        primaryTextColor: "#dcfff6",
        primaryBorderColor: "#78ffe2",
        secondaryColor: "#082826",
        tertiaryColor: "#082826",
        lineColor: "#78ffe2",
        textColor: "#dcfff6",
        edgeLabelBackground: "#061618",
        clusterBkg: "#04191a",
        clusterBorder: "#0e5c60",
        fontFamily: '"Martian Mono", ui-monospace, monospace',
        fontSize: "12px",
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

  const sizes = new Map<string, Promise<{ w: number; h: number } | undefined>>();
  return {
    /**
     * The diagram's natural size in px (from its SVG viewBox), so its card can be sized
     * to its content. Rendered once per source, off screen; undefined if it does not parse.
     */
    sizeOf(source: string): Promise<{ w: number; h: number } | undefined> {
      let size = sizes.get(source);
      if (!size) {
        size = loadMermaid()
          .then((m) => m.render(`jett-size-${++renders}`, source))
          .then(({ svg }) => {
            const box = svg.match(/viewBox="([-\d.e]+)[ ,]+([-\d.e]+)[ ,]+([\d.e]+)[ ,]+([\d.e]+)"/);
            return box ? { w: Number(box[3]), h: Number(box[4]) } : undefined;
          })
          .catch(() => undefined);
        sizes.set(source, size);
      }
      return size;
    },
    /** Match the layer to the diagram cards on screen: new ones render, changed sources re-render, gone ones go. */
    sync(items: DiagramBody[]) {
      const live = new Set<string>();
      for (const item of items) {
        live.add(item.id);
        let card = cards.get(item.id);
        if (!card) {
          const el = Object.assign(document.createElement("div"), { className: "sketch-card" });
          el.setAttribute("role", "img");
          layer.append(el);
          card = { el, source: "", render: 0 };
          cards.set(item.id, card);
        }
        // An image card: its picture (a data: URL from the core), or a loading note until it lands.
        const source = item.image ? `image:${item.image.src ?? ""}` : item.source;
        if (card.source !== source) {
          card.source = source;
          if (item.image) showImage(card, item.image.src, item.title);
          else void render(card, item.source);
        }
        const { el } = card;
        el.style.left = `${item.box.x}px`;
        el.style.top = `${item.box.y}px`;
        el.style.width = `${item.box.w}px`;
        el.style.height = `${item.box.h}px`;
        const what = item.image ? "Picture" : "Diagram";
        el.setAttribute("aria-label", item.title ? `${what}: ${item.title}` : what);
        // The diagram fades in once its card has opened and titled.
        el.dataset.shown = String(item.shown);
      }
      for (const [id, card] of cards) {
        if (live.has(id)) continue;
        cards.delete(id);
        card.render = -1;
        card.el.dataset.shown = "false";
        setTimeout(() => card.el.remove(), 300);
      }
    },
  };
}

/** An image card's picture: fills the body at its own shape; no src yet = loading. */
function showImage(card: Card, src: string | undefined, title?: string) {
  card.render = ++renders;
  if (!src) {
    card.el.dataset.state = "drawing";
    card.el.replaceChildren(Object.assign(document.createElement("p"), { className: "sketch-card-note", textContent: "Getting the picture…" }));
    return;
  }
  card.el.dataset.state = "ok";
  card.el.replaceChildren(Object.assign(document.createElement("img"), { className: "sketch-card-img", src, alt: title ?? "", draggable: false }));
}

/** A picture's natural size in px, once it decodes; undefined if it does not. */
export function imageSize(src: string): Promise<{ w: number; h: number } | undefined> {
  const img = new Image();
  img.src = src;
  return img.decode().then(
    () => (img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : undefined),
    () => undefined,
  );
}

export interface DiagramBody {
  id: string;
  /** Mermaid source (diagram cards); empty for image cards. */
  source: string;
  /** Set for an image card. */
  image?: { src?: string };
  title?: string;
  /** Screen px. */
  box: { x: number; y: number; w: number; h: number };
  shown: boolean;
}
