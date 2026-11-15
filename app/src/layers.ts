// Is the popover open (tickets 22, 36)? Pure, like panel.ts.
// - home: the overlay at rest, just the orb and the captions. You just talk.
// - center: the glass popover by the orb (chats, jobs, brain), opened from its menu
//   button and closed with its X or Escape. The call never notices: only the view changes.
export type Layer = "home" | "center";

/** open / close: the buttons. escape: the Escape key. show: something wants to be seen (the jobs badge). */
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
