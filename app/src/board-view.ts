// The job board (right) and the bottom bar (notes used + safety mode). Ticket 10.
// Renders only: core events in (through the pure reducers), commands out
// (cancel, set mode). The mode on screen comes only from the core's
// `mode.changed`, so the dropdown and Shift+Tab can never disagree.
import type { CoreClient } from "./core-client.ts";
import { addBarEvent, emptyBar, isModeCycleKey, type Bar } from "./bottom-bar.ts";
import { addJobEvent, emptyBoard, type JobBoard } from "./job-board.ts";
import type { SafetyMode } from "../../src/core/safety.ts";

const STATUS_LABELS = { waiting: "Waiting", working: "Working", done: "Done", failed: "Failed", cancelled: "Cancelled" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) {
  const node: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

export function mountBoardAndBar(core: CoreClient, jobsEl: HTMLElement, barEl: HTMLElement) {
  let board: JobBoard = emptyBoard;
  let bar: Bar = emptyBar;

  // ---- job board ----
  const list = el("ol", { className: "job-list" });
  const empty = el("p", { className: "job-empty", textContent: "No helper jobs yet." });
  jobsEl.append(el("h2", { className: "jobs-title", textContent: "Jobs" }), empty, list);

  function renderBoard() {
    empty.hidden = board.length > 0;
    list.replaceChildren(
      ...board.map((job) => {
        const li = el(
          "li",
          { className: "job" },
          el("div", { className: "job-head" },
            el("span", { className: "job-title", textContent: job.title, title: job.id }),
            el("span", { className: "job-status", textContent: STATUS_LABELS[job.status] }),
          ),
        );
        li.dataset.status = job.status;
        li.dataset.id = job.id;
        if (job.message) li.append(el("p", { className: "job-message", textContent: job.message }));
        if (job.cancellable) {
          const btn = el("button", { className: "job-cancel", type: "button", textContent: "Cancel" });
          btn.setAttribute("aria-label", `Cancel ${job.title}`);
          btn.onclick = () => {
            btn.disabled = true;
            core.cancelJob(job.id).catch(() => (btn.disabled = false));
          };
          li.append(btn);
        }
        return li;
      }),
    );
  }

  // ---- bottom bar ----
  const notesEl = el("span", { className: "bar-notes" });
  const select = el("select", { className: "bar-mode", id: "mode", disabled: true });
  select.setAttribute("aria-label", "Safety mode (Shift+Tab cycles)");
  select.onchange = () => {
    const wanted = select.value as SafetyMode;
    // Snap back to what the core says until its mode.changed arrives.
    if (bar.mode) select.value = bar.mode;
    core.setMode(wanted).catch(() => {});
  };
  barEl.append(
    notesEl,
    el("label", { className: "bar-mode-wrap", title: "Shift+Tab cycles" }, el("span", { textContent: "Safety" }), select),
  );

  function renderBar() {
    notesEl.replaceChildren(
      ...(bar.notes.length
        ? [el("span", { className: "bar-label", textContent: "Notes used" }), ...bar.notes.map((n) => el("code", { className: "bar-note", textContent: n }))]
        : [el("span", { className: "bar-label", textContent: "No notes used" })]),
    );
    if (bar.mode) {
      select.disabled = false;
      select.value = bar.mode;
      barEl.dataset.mode = bar.mode;
    }
  }

  core.onEvent((event) => {
    const nextBoard = addJobEvent(board, event);
    const nextBar = addBarEvent(bar, event);
    if (nextBoard !== board) (board = nextBoard), renderBoard();
    if (nextBar !== bar) (bar = nextBar), renderBar();
  });

  // First draw: the core says which modes exist (with their labels) and which
  // one is on. A mode.changed that beat this reply wins.
  core.getMode().then(({ mode, modes }) => {
    select.replaceChildren(...modes.map(({ id, label }) => el("option", { value: id, textContent: label })));
    if (bar.mode) select.value = bar.mode;
    else (bar = addBarEvent(bar, { type: "mode.changed", mode })), renderBar();
  }, () => {});

  // In-window shortcut, not a global one: only while this window has focus.
  window.addEventListener("keydown", (e) => {
    if (!isModeCycleKey(e)) return;
    e.preventDefault();
    core.setMode("cycle").catch(() => {});
  });

  renderBoard();
  renderBar();
}
