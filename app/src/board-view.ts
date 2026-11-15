// The job board (right) and the status line (notes used). Ticket 10; the safety mode moved to the composer pill (mode-pill.ts, ticket 27).
// Renders only: core events in (through the pure reducers), the cancel command out.
import type { CoreClient } from "./core-client.ts";
import { addBarEvent, emptyBar, type Bar } from "./bottom-bar.ts";
import { addJobEvent, emptyBoard, type JobBoard } from "./job-board.ts";

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
  barEl.append(notesEl);

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
        : []),
    );
  }

  core.onEvent((event) => {
    const nextBoard = addJobEvent(board, event);
    // A job just started: show the drawer.
    if (event.type === "job.state" && (event.state === "queued" || event.state === "running") && !board.some((j) => j.id === event.id)) setOpen(true);
    const nextBar = addBarEvent(bar, event);
    if (nextBoard !== board) (board = nextBoard), renderBoard();
    if (nextBar !== bar) (bar = nextBar), renderBar();
  });

  renderBoard();
  renderBar();
}
