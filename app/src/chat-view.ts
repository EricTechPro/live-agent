// The sidebar's past chats (ticket 24). Renders only: the list comes from the
// core (GET /brain/chats), rows from the pure chat-list.ts, and a click opens
// the chat's note in the brain view's read-only reader. It never resumes Live.
// Each row has a delete under the cursor (or keyboard focus); it asks inline, in
// the row itself ("Delete this chat?" Delete / Cancel), never with a dialog.
import type { CoreClient } from "./core-client.ts";
import type { PastChat } from "../../src/brain/chats.ts";
import type { BrainReader } from "./brain-view.ts";
import { chatRows, refreshesChats } from "./chat-list.ts";
import { iconSvg } from "./icons.ts";
import type { UiKey } from "./ui-words.ts";

export interface ChatViewEls {
  list: HTMLUListElement;
  empty: HTMLElement;
}

export function mountChatView(core: CoreClient, reader: BrainReader, els: ChatViewEls, words: (key: UiKey) => string, onError: (text: string) => void) {
  let chats: PastChat[] = [];
  let current: string | undefined;
  /** The row asking "Delete this chat?", if any. */
  let confirming: string | undefined;
  let deleting = false;

  function confirmRow(path: string) {
    const li = document.createElement("li");
    li.className = "chat-row confirm";
    li.setAttribute("role", "group");
    li.setAttribute("aria-label", words("deleteAsk"));
    const ask = Object.assign(document.createElement("span"), { className: "chat-ask", textContent: words("deleteAsk") });
    const yes = Object.assign(document.createElement("button"), { type: "button", className: "chat-del-yes", textContent: words("delete") });
    const no = Object.assign(document.createElement("button"), { type: "button", className: "chat-del-no", textContent: words("cancel") });
    yes.disabled = deleting;
    yes.onclick = () => void remove(path);
    no.onclick = () => cancel(path);
    li.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // the popover's Esc waits: this closes first
      e.stopPropagation();
      cancel(path);
    });
    li.append(ask, no, yes);
    return li;
  }
  function cancel(path: string) {
    confirming = undefined;
    render();
    els.list.querySelector<HTMLButtonElement>(`.chat-item[data-path="${CSS.escape(path)}"]`)?.focus();
  }
  async function remove(path: string) {
    deleting = true;
    render();
    try {
      await core.deleteChat(path);
      chats = chats.filter((c) => c.path !== path);
    } catch (err) {
      onError(`delete: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      deleting = false;
      confirming = undefined;
      render();
    }
  }

  function render() {
    els.empty.hidden = chats.length > 0;
    els.list.replaceChildren(
      ...chatRows(chats, new Date()).map((row) => {
        if (row.path === confirming) return confirmRow(row.path);
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
        const del = document.createElement("button");
        del.type = "button";
        del.className = "ib chat-del";
        del.innerHTML = iconSvg("trash", 12);
        del.setAttribute("aria-label", `${words("deleteChat")}: ${row.title}`);
        del.dataset.tip = words("deleteChat");
        del.dataset.side = "left";
        del.onclick = () => {
          confirming = row.path;
          render();
          els.list.querySelector<HTMLButtonElement>(".chat-del-no")?.focus();
        };
        li.append(btn, del);
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
