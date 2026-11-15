// The sidebar's past chats (ticket 24). Renders only: the list comes from the
// core (GET /brain/chats), rows from the pure chat-list.ts, and a click opens
// the chat's note in the brain view's read-only reader. It never resumes Live.
import type { CoreClient } from "./core-client.ts";
import type { PastChat } from "../../src/brain/chats.ts";
import type { BrainReader } from "./brain-view.ts";
import { chatRows, refreshesChats } from "./chat-list.ts";
import { iconSvg } from "./icons.ts";

export interface ChatViewEls {
  list: HTMLUListElement;
  empty: HTMLElement;
}

export function mountChatView(core: CoreClient, reader: BrainReader, els: ChatViewEls) {
  let chats: PastChat[] = [];
  let current: string | undefined;

  function render() {
    els.empty.hidden = chats.length > 0;
    els.list.replaceChildren(
      ...chatRows(chats, new Date()).map((row) => {
        const li = document.createElement("li");
        li.className = "chat-row";
        if (row.path === current) li.setAttribute("aria-current", "true");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "chat-item";
        btn.dataset.path = row.path;
        btn.title = row.title;
        btn.innerHTML = iconSvg("chat", 12);
        btn.append(
          Object.assign(document.createElement("span"), { className: "chat-title", textContent: row.title }),
          Object.assign(document.createElement("time"), { className: "chat-when", textContent: row.when, dateTime: chats.find((c) => c.path === row.path)?.date ?? "" }),
        );
        btn.onclick = () => void reader.open(row.path, row.title);
        li.append(btn);
        return li;
      }),
    );
  }

  async function load() {
    try {
      chats = await core.pastChats();
    } catch {
      chats = [];
    }
    render();
  }

  reader.onCurrent((path) => {
    const was = current;
    current = path && chats.some((c) => c.path === path) ? path : undefined;
    render();
    // Closing a chat's note puts focus back on its row.
    if (!path && was) els.list.querySelector<HTMLButtonElement>(`[data-path="${CSS.escape(was)}"]`)?.focus();
  });
  core.onEvent((event) => {
    if (refreshesChats(event)) void load();
  });
  // "5m" turns into "6m" while the window stays open.
  setInterval(render, 60_000);
  void load();
}
