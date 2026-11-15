// The sidebar's brain tree and the read-only note reader (ticket 23). Renders only:
// the tree comes from the core (GET /brain/tree), rows from the pure brain-tree.ts,
// and a click reads one note (GET /brain/file). Nothing here writes to the brain.
import type { CoreClient } from "./core-client.ts";
import type { BrainTree } from "../../src/brain/tree.ts";
import { brainRows, refreshesTree, startFolders, toggleFolder } from "./brain-tree.ts";
import { iconSvg } from "./icons.ts";

export interface BrainViewEls {
  tree: HTMLUListElement;
  empty: HTMLElement;
  reader: HTMLElement;
  readerName: HTMLElement;
  readerPath: HTMLElement;
  readerText: HTMLElement;
  closeReader: HTMLButtonElement;
  /** Hidden while a note is open: the reader takes its place. */
  transcript: HTMLElement;
}

export function mountBrainView(core: CoreClient, els: BrainViewEls) {
  let tree: BrainTree | undefined;
  let open = new Set<string>();
  let current: string | undefined;

  function render() {
    els.empty.hidden = !!tree && tree.parts.some((p) => p.children.length > 0);
    if (!tree) return els.tree.replaceChildren();
    els.tree.replaceChildren(
      ...brainRows(tree, open).map((row) => {
        const li = document.createElement("li");
        li.className = `brain-row ${row.kind}`;
        li.style.setProperty("--depth", String(row.depth));
        li.setAttribute("role", "treeitem");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "brain-item";
        btn.title = row.path;
        const name = Object.assign(document.createElement("span"), { className: "brain-name", textContent: row.name });
        if (row.kind === "file") {
          btn.innerHTML = iconSvg("file", 12);
          btn.append(name);
          btn.dataset.path = row.path;
          if (row.path === current) li.setAttribute("aria-selected", "true");
          btn.onclick = () => void openNote(row.path);
        } else {
          li.setAttribute("aria-expanded", String(row.open));
          btn.innerHTML = `<span class="brain-chev" aria-hidden="true">${iconSvg("chevron", 10)}</span>${iconSvg("folder", 12)}`;
          btn.append(name);
          if (row.kind === "part") btn.append(Object.assign(document.createElement("span"), { className: "brain-count", textContent: String(row.count) }));
          btn.onclick = () => {
            open = toggleFolder(open, row.path);
            render();
            els.tree.querySelector<HTMLButtonElement>(`[title="${CSS.escape(row.path)}"]`)?.focus();
          };
        }
        li.append(btn);
        return li;
      }),
    );
  }

  async function load() {
    try {
      const next = await core.brainTree();
      // First load (or another brain after setup): the parts open. Later loads keep what you opened.
      const sameBrain = tree && tree.parts.every((p, i) => next.parts[i]?.folder === p.folder);
      if (!sameBrain) open = startFolders(next);
      tree = next;
    } catch {
      tree = undefined;
    }
    render();
  }

  async function openNote(path: string) {
    current = path;
    render();
    els.readerName.textContent = path.split("/").pop() ?? path;
    els.readerPath.textContent = path;
    els.readerText.textContent = "";
    showReader(true);
    try {
      const note = await core.brainFile(path);
      if (current !== path) return;
      els.readerText.textContent = note.truncated ? `${note.text}\n\n…` : note.text;
    } catch (err) {
      if (current === path) els.readerText.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  function showReader(on: boolean) {
    els.reader.hidden = !on;
    els.transcript.hidden = on;
    if (!on) {
      const was = current;
      current = undefined;
      render();
      if (was) els.tree.querySelector<HTMLButtonElement>(`[data-path="${CSS.escape(was)}"]`)?.focus();
    }
  }

  els.closeReader.onclick = () => showReader(false);
  // Escape closes the note first (capture: before the control center's own Escape).
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || els.reader.hidden || e.defaultPrevented) return;
      e.preventDefault();
      showReader(false);
    },
    true,
  );
  core.onEvent((event) => {
    if (refreshesTree(event)) void load();
  });
  void load();
}
