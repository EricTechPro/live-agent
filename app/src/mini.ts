// Mini mode (ticket 15): the Mini button shrinks the window into a small
// always-on-top orb that shows how many jobs are running; clicking the orb
// opens the full window again.
//
// The same window and page stay alive (Rust `set_mini` only resizes it and
// drops the frame), so the LiveKit room and the core's event stream are never
// touched: voice keeps working. Here we only swap CSS and keep the count fresh.
import { setMiniWindow, type CoreClient } from "./core-client.ts";
import { addJobEvent, emptyBoard, runningCount, type JobBoard } from "./job-board.ts";

export function mountMini(core: CoreClient, button: HTMLButtonElement, orbEl: HTMLElement, countEl: HTMLElement) {
  let board: JobBoard = emptyBoard;
  const renderCount = () => {
    const n = runningCount(board);
    countEl.textContent = String(n);
    countEl.dataset.count = String(n);
    countEl.title = n === 1 ? "1 job running" : `${n} jobs running`;
  };
  core.onEvent((event) => {
    const next = addJobEvent(board, event);
    if (next !== board) {
      board = next;
      renderCount();
    }
  });
  renderCount();

  let mini = false;
  async function setMini(on: boolean) {
    if (on === mini) return;
    mini = on;
    document.body.classList.toggle("mini", on);
    orbEl.title = on ? "Open the full window" : "";
    try {
      await setMiniWindow(on);
    } catch {
      // Outside Tauri (browser preview) only the CSS changes.
    }
  }

  button.disabled = false;
  button.onclick = () => setMini(true);
  orbEl.addEventListener("click", () => {
    if (mini) setMini(false);
  });
}
