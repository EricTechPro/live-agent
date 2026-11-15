// Which layer the window shows (ticket 22). Pure, like diagram.ts.
// - home: the big orb and the call controls, almost nothing else. You just talk.
// - center: the control center (sidebar, chat, right panel), opened from home and
//   closed with its X or Escape. The call never notices: only the view changes.
export type Layer = "home" | "center";

/** open / close: the buttons. escape: the Escape key. show: something wants to be seen (a diagram, the Jobs button). */
export type LayerAction = "open" | "close" | "escape" | "show";

export const startLayer: Layer = "home";

export function nextLayer(layer: Layer, action: LayerAction): Layer {
  switch (action) {
    case "open":
    case "show":
      return "center";
    case "close":
    case "escape":
      return "home";
    default:
      return layer;
  }
}
