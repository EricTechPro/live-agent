// The Reminders card (gap #5): "Today 1 / Later 2", a ring checkbox per row, the time on the
// right. It opens on a `reminders` event with `show` (remind, list_reminders, a due one) and
// follows every later `reminders` event; ticking a ring tells the core (POST /reminders/done).
// A due reminder also plays a soft two-note chime. Roamies idea, our own code.
import type { AgentEvent } from "../../src/core/events.ts";
import type { Reminder } from "../../src/reminders.ts";
import type { CoreClient } from "./core-client.ts";
import { reminderSections, type Row } from "./reminder-rows.ts";

function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = hz;
      const t = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // No audio: the card and the voice still nudge.
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function mountReminders(core: CoreClient, host: HTMLElement) {
  const card = el("section", "rem-card");
  card.dataset.hit = "";
  card.hidden = true;
  card.setAttribute("aria-label", "Reminders");
  const head = el("header", "rem-head");
  head.append(el("span", "rem-dots"), el("h2", "rem-title", "reminders"));
  const close = el("button", "rem-x", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close reminders");
  close.onclick = () => (card.hidden = true);
  head.append(close);
  const body = el("div", "rem-body");
  card.append(head, body);
  host.append(card);
  let items: Reminder[] = [];

  function section(name: string, rows: Row[]) {
    const wrap = el("div", "rem-section");
    const h = el("h3", "rem-section-title", name);
    h.append(el("span", "rem-count", ` ${rows.length}`));
    wrap.append(h);
    const list = el("ul", "rem-list");
    for (const row of rows) {
      const li = el("li", "rem-row");
      li.dataset.overdue = String(row.overdue);
      const tick = el("button", "rem-ring");
      tick.type = "button";
      tick.setAttribute("aria-label", `Done: ${row.text}`);
      tick.onclick = () => {
        li.dataset.done = "true";
        core.doneReminder(row.id).catch(() => delete li.dataset.done);
      };
      li.append(tick, el("span", "rem-text", row.text), el("span", "rem-time", row.time));
      list.append(li);
    }
    wrap.append(list);
    return wrap;
  }

  function render() {
    const { today, later } = reminderSections(items, new Date());
    body.replaceChildren();
    if (!today.length && !later.length) body.append(el("p", "rem-empty", "Nothing to remind you about."));
    if (today.length) body.append(section("Today", today));
    if (later.length) body.append(section("Later", later));
  }

  core.onEvent((event: AgentEvent) => {
    if (event.type !== "reminders") return;
    items = event.items;
    render();
    if (event.show) card.hidden = false;
    if (event.due?.length) chime();
  });
  // Times like "in 5 min" move from Later to Today at midnight; once a minute is plenty.
  setInterval(() => !card.hidden && render(), 60_000);
  return card;
}
