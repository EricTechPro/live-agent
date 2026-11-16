// The sidebar's brain tree (ticket 23). Pure, like transcript.ts: the core's tree
// plus which folders are open in, the rows to draw out. The core serves the tree
// (GET /brain/tree, src/brain/tree.ts); a click on a file reads it read-only.
import type { AgentEvent } from "../../src/core/events.ts";
import type { BrainTree, TreeNode } from "../../src/brain/tree.ts";

export type BrainRow =
  | { kind: "part"; part: string; name: string; path: string; depth: 0; open: boolean; count: number }
  | { kind: "dir"; name: string; path: string; depth: number; open: boolean }
  | { kind: "file"; name: string; path: string; depth: number };

/** The three parts open, every folder inside them closed. */
export function startFolders(tree: BrainTree): Set<string> {
  return new Set(tree.parts.map((p) => p.folder));
}

export function toggleFolder(open: Set<string>, path: string): Set<string> {
  const next = new Set(open);
  if (!next.delete(path)) next.add(path);
  return next;
}

const countFiles = (nodes: TreeNode[]): number => nodes.reduce((n, c) => n + (c.kind === "file" ? 1 : countFiles(c.children)), 0);

export function brainRows(tree: BrainTree, open: Set<string>): BrainRow[] {
  const rows: BrainRow[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.kind === "file") rows.push({ kind: "file", name: node.name, path: node.path, depth });
      else {
        const isOpen = open.has(node.path);
        rows.push({ kind: "dir", name: node.name, path: node.path, depth, open: isOpen });
        if (isOpen) walk(node.children, depth + 1);
      }
    }
  };
  for (const p of tree.parts) {
    const isOpen = open.has(p.folder);
    rows.push({ kind: "part", part: p.part, name: p.folder, path: p.folder, depth: 0, open: isOpen, count: countFiles(p.children) });
    if (isOpen) walk(p.children, 1);
  }
  return rows;
}

/** Events after which the tree may have changed: a note written, a new chat (its note), new setup (another brain). */
export function refreshesTree(event: AgentEvent): boolean {
  return event.type === "brain.write" || event.type === "chat.started" || event.type === "setup.saved";
}
