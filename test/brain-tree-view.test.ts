// Ticket 23, window side: the sidebar's brain tree as rows, folders collapsible. Pure.
import { expect, test } from "bun:test";
import { brainRows, refreshesTree, toggleFolder, startFolders } from "../app/src/brain-tree.ts";
import type { BrainTree } from "../src/brain/tree.ts";

const tree: BrainTree = {
  parts: [
    { part: "raw", folder: "_inbox", children: [{ kind: "file", name: "a.md", path: "_inbox/a.md" }] },
    {
      part: "wiki",
      folder: "wiki",
      children: [
        { kind: "dir", name: "baking", path: "wiki/baking", children: [{ kind: "file", name: "rye.md", path: "wiki/baking/rye.md" }] },
        { kind: "file", name: "sourdough.md", path: "wiki/sourdough.md" },
      ],
    },
    { part: "projects", folder: "projects", children: [] },
  ],
};

const show = (open: Set<string>) => brainRows(tree, open).map((r) => `${"  ".repeat(r.depth)}${r.kind === "file" ? "" : r.open ? "v " : "> "}${r.name}`);

test("the three parts start open, their sub folders closed", () => {
  expect(show(startFolders(tree))).toEqual(["v _inbox", "  a.md", "v wiki", "  > baking", "  sourdough.md", "v projects"]);
});

test("a part row shows its configured folder name and says which part it is", () => {
  const rows = brainRows(tree, startFolders(tree));
  expect(rows[0]).toMatchObject({ kind: "part", part: "raw", name: "_inbox", path: "_inbox", count: 1 });
  expect(rows.find((r) => r.name === "wiki")).toMatchObject({ count: 2 });
});

test("clicking a folder opens it, clicking again closes it", () => {
  const open = toggleFolder(startFolders(tree), "wiki/baking");
  expect(show(open)).toEqual(["v _inbox", "  a.md", "v wiki", "  v baking", "    rye.md", "  sourdough.md", "v projects"]);
  expect(show(toggleFolder(open, "wiki"))).toEqual(["v _inbox", "  a.md", "> wiki", "v projects"]);
});

test("a note written into the brain (or a new chat, or new setup) asks for a fresh tree", () => {
  expect(refreshesTree({ type: "brain.write", path: "raw/x.md", cause: "tool", tool: "remember" })).toBe(true);
  expect(refreshesTree({ type: "chat.started" })).toBe(true);
  expect(refreshesTree({ type: "turn.done", reply: "hi" })).toBe(false);
});
