// Following the screen while Jett's drawing is up (slices 3 and 4).
//
//   const follow = createFollow({ eyes, emit, onStale });
//   follow.active(true)              // cards or marks are up: watch the screen
//   follow.pin(["p3", "p4"], front)  // screen marks aimed at this front window
//
// Two jobs, one helper (`jett-eyes watch`):
//   - the front window's rect goes to the window as `screen.front`, so cards keep off it;
//   - screen marks are pinned to the window they were found in. When that window moves,
//     resizes, changes title (a new page), the app switches, or the user scrolls or clicks
//     in it, what they point at may have moved: they go stale and are erased.
// Idea from Roamies (AGPL): idea only, our own code.
import type { AgentEvent } from "../core/events.ts";
import type { Eyes, FrontWindow, WatchEvent } from "./eyes.ts";
import type { Rect } from "./geometry.ts";

const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const moved = (a?: Rect, b?: Rect, tol = 2) =>
  !a || !b ? a !== b : Math.abs(a.x - b.x) > tol || Math.abs(a.y - b.y) > tol || Math.abs(a.w - b.w) > tol || Math.abs(a.h - b.h) > tol;

/**
 * Why marks found in `base` no longer point at the right place after `event`, or undefined
 * if they still do. Pure: test/screen-marks.test.ts covers every case.
 */
export function staleReason(base: FrontWindow | null, event: WatchEvent): string | undefined {
  if (event.type === "front") {
    const now = event.front;
    if (!base) return undefined;
    if (!now) return "the window closed";
    if (now.pid !== base.pid) return `switched to ${now.app}`;
    if (base.windowId !== undefined && now.windowId !== undefined && now.windowId !== base.windowId) return "switched window";
    if (moved(base.bounds, now.bounds)) return "the window moved";
    if ((base.title ?? "") !== (now.title ?? "")) return "the page changed";
    return undefined;
  }
  // A scroll or click in the marked window (anywhere, if its bounds are unknown).
  if (base?.bounds && !inside(event.at, base.bounds)) return undefined;
  return event.type === "scroll" ? "scrolled" : "clicked";
}

export interface FollowDeps {
  eyes: Pick<Eyes, "watch">;
  emit(event: AgentEvent): void;
  /** These marks went stale: erase them. */
  onStale(ids: string[], reason: string): void;
}

export interface Follow {
  /** Watch the screen (true) or stop (false). Pinned marks keep it on. */
  active(on: boolean): void;
  /** Pin marks to the window they were found in. */
  pin(ids: string[], base: FrontWindow | null): void;
  /** Forget marks (erased, or a new chat). No ids: all. */
  unpin(ids?: string[]): void;
  /** The last front window seen (undefined before the first report). */
  front(): FrontWindow | null | undefined;
  stop(): void;
}

export function createFollow({ eyes, emit, onStale }: FollowDeps): Follow {
  let wanted = false;
  let stopWatch: (() => void) | undefined;
  let last: FrontWindow | null | undefined;
  let groups: { ids: Set<string>; base: FrontWindow | null }[] = [];

  function on(event: WatchEvent) {
    if (event.type === "front") {
      last = event.front;
      emit({ type: "screen.front", front: event.front });
    }
    const keep: typeof groups = [];
    for (const g of groups) {
      const why = staleReason(g.base, event);
      if (why) onStale([...g.ids], why);
      else keep.push(g);
    }
    groups = keep;
    sync();
  }

  function sync() {
    const need = wanted || groups.length > 0;
    if (need && !stopWatch && eyes.watch) stopWatch = eyes.watch(on);
    if (!need && stopWatch) {
      stopWatch();
      stopWatch = undefined;
      last = undefined;
    }
  }

  return {
    active(next) {
      wanted = next;
      sync();
    },
    pin(ids, base) {
      if (ids.length) groups.push({ ids: new Set(ids), base });
      sync();
    },
    unpin(ids) {
      if (!ids) groups = [];
      else {
        for (const g of groups) for (const id of ids) g.ids.delete(id);
        groups = groups.filter((g) => g.ids.size);
      }
      sync();
    },
    front: () => last,
    stop() {
      groups = [];
      wanted = false;
      sync();
    },
  };
}
