// Where an icon button's tooltip goes (ticket 26). Pure, so it is tested without a DOM.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Under the button, centred, inside the window; above it when there is no room below.
 * `prefer: "left"` (a button's `data-side="left"`): left of the button, centred on it,
 * for buttons with another control right under them (the control center's X sits over
 * the right panel's X). Falls back to below when there is no room on the left.
 */
export function placeTip(
  anchor: Box,
  tip: { width: number; height: number },
  view: { width: number; height: number },
  gap = 8,
  margin = 6,
  prefer?: "left",
) {
  if (prefer === "left" && anchor.left - gap - tip.width >= margin) {
    const middle = anchor.top + anchor.height / 2 - tip.height / 2;
    const top = Math.max(margin, Math.min(middle, view.height - tip.height - margin));
    return { left: Math.round(anchor.left - gap - tip.width), top: Math.round(top), side: "left" } as const;
  }
  const below = anchor.top + anchor.height + gap;
  const side = below + tip.height + margin > view.height && anchor.top - gap - tip.height >= margin ? "above" : "below";
  const top = side === "below" ? below : anchor.top - gap - tip.height;
  const centred = anchor.left + anchor.width / 2 - tip.width / 2;
  const left = Math.max(margin, Math.min(centred, view.width - tip.width - margin));
  return { left: Math.round(left), top: Math.round(top), side } as const;
}
