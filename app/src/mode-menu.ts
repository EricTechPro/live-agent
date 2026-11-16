// The composer's safety mode pill menu (ticket 27), keyboard and clicks. Pure, like
// bottom-bar.ts. The menu only says which mode was picked; the mode on screen still
// comes only from the core's `mode.changed`.

export interface ModeMenu {
  open: boolean;
  /** The highlighted row while open. */
  active: number;
}

export const closedMenu: ModeMenu = { open: false, active: 0 };

export interface MenuStep {
  menu: ModeMenu;
  /** A row was chosen: ask the core for this mode. */
  pick?: number;
  /** The key did something here (so the window should not also act on it, e.g. Escape closing the control center). */
  handled: boolean;
}

/**
 * One key on the pill (menu closed) or the open menu.
 * `count` rows; `current` = the row of the mode in use, where the highlight starts.
 */
export function menuKey(menu: ModeMenu, key: string, count: number, current: number): MenuStep {
  if (!menu.open) {
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") return { menu: { open: true, active: current }, handled: true };
    return { menu, handled: false };
  }
  switch (key) {
    case "ArrowDown":
      return { menu: { open: true, active: (menu.active + 1) % count }, handled: true };
    case "ArrowUp":
      return { menu: { open: true, active: (menu.active - 1 + count) % count }, handled: true };
    case "Home":
      return { menu: { open: true, active: 0 }, handled: true };
    case "End":
      return { menu: { open: true, active: count - 1 }, handled: true };
    case "Enter":
    case " ":
      return { menu: { open: false, active: menu.active }, pick: menu.active, handled: true };
    case "Escape":
      return { menu: { open: false, active: menu.active }, handled: true };
    case "Tab":
      // Leave the menu, and let focus move on as usual.
      return { menu: { open: false, active: menu.active }, handled: false };
    default:
      return { menu, handled: false };
  }
}

/** A click on the pill opens or closes the menu, starting on the mode in use. */
export function menuToggle(menu: ModeMenu, current: number): ModeMenu {
  return menu.open ? { open: false, active: menu.active } : { open: true, active: current };
}
