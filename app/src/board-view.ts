// The job board (the right panel's Jobs tab, ticket 25) and the status line (notes used). Ticket 10; the safety mode moved to the composer pill (mode-pill.ts, ticket 27).
// Renders only: core events in (through the pure reducers), the cancel command out.
import type { CoreClient } from "./core-client.ts";
import { addBarEvent, emptyBar, type Bar } from "./bottom-bar.ts";
import { addJobEvent, elapsed, emptyBoard, type JobBoard, type JobRow } from "./job-board.ts";
import { iconSvg, type IconName } from "./icons.ts";

const STATUS_LABELS = { waiting: "Waiting", working: "Working", done: "Done", failed: "Failed", cancelled: "Cancelled" };
// Each helper's pixel mark on its card (ticket 29); anything else gets the jobs icon.
const HELPER_ICONS: Record<string, IconName> = { "claude-code": "claude", codex: "codex", "gemini-cli": "gemini", tidy: "tidy" };
// Each job's LED: blinking while it works, lit when done, red when it failed, dark otherwise.
const STATUS_LEDS = { waiting: "led", working: "led busy", done: "led on", failed: "led bad", cancelled: "led" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) {
  const node: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

// The bar shows at most this many notes as chips (file name; full path on hover), then "+N".
const NOTE_CHIPS = 3;

/** Where the running count shows: the top bar's Jobs icon and the panel's Jobs tab (ticket 25), each with a badge. */
export interface JobsBadges {
  buttons: { button: HTMLElement; count: HTMLElement; label: string }[];
}

export function mountBoardAndBar(core: CoreClient, jobsEl: HTMLElement, barEl: HTMLElement, toggle?: JobsBadges) {
  let board: JobBoard = emptyBoard;
  let bar: Bar = emptyBar;

  // ---- job board (the right panel's Jobs tab; a new job never switches to it) ----
  const list = el("ol", { className: "job-list" });
  const empty = el("p", { className: "job-empty", textContent: "No helper jobs yet." });
  jobsEl.append(empty, list);

  function renderBoard() {
    empty.hidden = board.length > 0;
    if (toggle) {
      const running = board.filter((j) => j.status === "working" || j.status === "waiting").length;
      const failed = !running && board.some((j) => j.status === "failed");
      // Each badge: the running count, hidden at 0, red when one failed.
      for (const { button, count, label } of toggle.buttons) {
        count.textContent = String(running);
        count.dataset.count = String(running);
        button.dataset.failed = String(failed);
        button.setAttribute("aria-label", running ? `${label}, ${running} running` : label);
      }
    }
    list.replaceChildren(...board.map(card));
  }

  // Cards you opened stay open when the board redraws.
  const expanded = new Set<string>();

  function card(job: JobRow) {
    const li = el("li", { className: "pf job" });
    li.dataset.status = job.status;
    li.dataset.id = job.id;
    const mark = el("span", { className: "job-helper" });
    mark.innerHTML = iconSvg(HELPER_ICONS[job.helper] ?? "jobs", 14);
    mark.dataset.tip = job.helperLabel;
    const head = el("div", { className: "job-head" },
      mark,
      el("span", { className: "job-title", textContent: job.title, title: job.title }),
    );
    if (job.cancellable) {
      const btn = el("button", { className: "ib job-cancel", type: "button" });
      btn.innerHTML = iconSvg("close", 12);
      btn.setAttribute("aria-label", `Cancel ${job.title}`);
      btn.dataset.tip = "Cancel job";
      btn.onclick = () => {
        btn.disabled = true;
        core.cancelJob(job.id).catch(() => (btn.disabled = false));
      };
      head.append(btn);
    }
    li.append(head);

    // One quiet line: state, helper, elapsed time (ticking while it works), folder or branch.
    const meta = el("p", { className: "job-meta" },
      el("span", { className: "job-status" }, el("span", { className: STATUS_LEDS[job.status] }), STATUS_LABELS[job.status]),
      el("span", { textContent: job.helperLabel }),
    );
    const time = elapsed(job, Date.now());
    if (time || job.status === "working") {
      const t = el("span", { className: "job-time", textContent: time });
      if (job.status === "working" && job.startedAt !== undefined) t.dataset.since = String(job.startedAt);
      meta.append(t);
    }
    const where = job.worktree ? job.worktree.branch : job.folder ? (job.folder.split("/").filter(Boolean).pop() ?? job.folder) : "";
    if (where) meta.append(el("span", { className: "job-folder", textContent: where, title: job.worktree ? job.worktree.path : job.folder! }));
    li.append(meta);

    // Done or failed: one plain line; click it for the whole answer or error.
    const line = job.summary ?? job.message;
    if (line) {
      const full = job.output ?? job.message ?? line;
      const more = full.trim() !== line.trim();
      const open = more && expanded.has(job.id);
      const summary = el(more ? "button" : "p", { className: "job-summary", textContent: line });
      if (more) {
        const btn = summary as HTMLButtonElement;
        btn.type = "button";
        btn.setAttribute("aria-expanded", String(open));
        btn.title = open ? "Hide output" : "Show full output";
        btn.insertAdjacentHTML("beforeend", `<span class="job-chev" aria-hidden="true">${iconSvg("chevron", 10)}</span>`);
        btn.onclick = () => {
          if (!expanded.delete(job.id)) expanded.add(job.id);
          renderBoard();
          list.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(job.id)}"] .job-summary`)?.focus();
        };
      }
      li.append(summary);
      if (open) li.append(el("pre", { className: "job-output", textContent: full, tabIndex: 0 }));
    }
    return li;
  }

  // The elapsed time of working jobs ticks once a second, without redrawing the cards.
  setInterval(() => {
    for (const t of list.querySelectorAll<HTMLElement>(".job-time[data-since]")) {
      t.textContent = elapsed({ startedAt: Number(t.dataset.since) }, Date.now());
    }
  }, 1000);

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
    const nextBar = addBarEvent(bar, event);
    if (nextBoard !== board) (board = nextBoard), renderBoard();
    if (nextBar !== bar) (bar = nextBar), renderBar();
  });

  renderBoard();
  renderBar();
}
