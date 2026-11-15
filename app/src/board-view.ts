// The job board (right) and the bottom bar (notes used + safety mode). Ticket 10.
// Renders only: core events in (through the pure reducers), commands out
// (cancel, set mode). The mode on screen comes only from the core's
// `mode.changed`, so the dropdown and Shift+Tab can never disagree.
import type { CoreClient } from "./core-client.ts";
import { addBarEvent, emptyBar, isModeCycleKey, type Bar } from "./bottom-bar.ts";
import { addJobEvent, emptyBoard, type JobBoard } from "./job-board.ts";
import type { SafetyMode } from "../../src/core/safety.ts";

const STATUS_LABELS = { waiting: "Waiting", working: "Working", done: "Done", failed: "Failed", cancelled: "Cancelled" };
// Each job's LED: blinking while it works, lit when done, red when it failed, dark otherwise.
const STATUS_LEDS = { waiting: "led", working: "led busy", done: "led on", failed: "led bad", cancelled: "led" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) {
  const node: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

// The bar shows at most this many notes as chips (file name; full path on hover), then "+N".
const NOTE_CHIPS = 3;

/** The job board drawer's toggle chip ("Jobs 0") and its count. */
export interface JobsToggle {
  button: HTMLButtonElement;
  count: HTMLElement;
}

export function mountBoardAndBar(core: CoreClient, jobsEl: HTMLElement, barEl: HTMLElement, toggle?: JobsToggle) {
  let board: JobBoard = emptyBoard;
  let bar: Bar = emptyBar;

  // The board is a drawer: shut while empty, opened by the Jobs chip or when a job starts.
  const setOpen = (open: boolean) => {
    jobsEl.classList.toggle("open", open);
    toggle?.button.setAttribute("aria-expanded", String(open));
  };
  if (toggle) toggle.button.onclick = () => setOpen(!jobsEl.classList.contains("open"));

  // ---- job board ----
  const list = el("ol", { className: "job-list" });
  const empty = el("p", { className: "job-empty", textContent: "No helper jobs yet." });
  jobsEl.append(el("h2", { className: "jobs-title", textContent: "Jobs" }), empty, list);

  function renderBoard() {
    empty.hidden = board.length > 0;
    if (toggle) {
      const running = board.filter((j) => j.status === "working" || j.status === "waiting").length;
      // The Jobs icon's badge: the running count, hidden at 0, red when one failed.
      toggle.count.textContent = String(running);
      toggle.count.dataset.count = String(running);
      toggle.button.dataset.failed = String(!running && board.some((j) => j.status === "failed"));
      toggle.button.setAttribute("aria-label", running ? `Jobs, ${running} running` : "Jobs");
    }
    list.replaceChildren(
      ...board.map((job) => {
        const li = el(
          "li",
          { className: "pf job" },
          el("div", { className: "job-head" },
            el("span", { className: STATUS_LEDS[job.status] }),
            el("span", { className: "job-title", textContent: job.title, title: job.id }),
            el("span", { className: "job-status", textContent: STATUS_LABELS[job.status] }),
          ),
        );
        li.dataset.status = job.status;
        li.dataset.id = job.id;
        if (job.worktree) {
          li.append(el("p", { className: "job-worktree", textContent: `Branch ${job.worktree.branch}\n${job.worktree.path}` }));
        }
        if (job.message) li.append(el("p", { className: "job-message", textContent: job.message }));
        if (job.cancellable) {
          const btn = el("button", { className: "pf btn ghost small job-cancel", type: "button", textContent: "Cancel" });
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
    el("label", { className: "bar-mode-wrap", title: "Shift+Tab cycles" }, el("span", { textContent: "Safety" }), el("span", { className: "pf sel" }, select)),
  );

  function renderBar() {
    notesEl.replaceChildren(
      ...(bar.notes.length
        ? [
            el("span", { className: "bar-label", textContent: "Notes used" }),
            ...bar.notes.slice(0, NOTE_CHIPS).map((n) => el("code", { className: "bar-note", textContent: n.split("/").pop() ?? n, title: n })),
            ...(bar.notes.length > NOTE_CHIPS
              ? [el("span", { className: "bar-more", textContent: `+${bar.notes.length - NOTE_CHIPS}`, title: bar.notes.slice(NOTE_CHIPS).join("\n") })]
              : []),
          ]
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
    // A job just started: show the drawer.
    if (event.type === "job.state" && (event.state === "queued" || event.state === "running") && !board.some((j) => j.id === event.id)) setOpen(true);
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
