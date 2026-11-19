// write_file: write a quick text file inside the brain (notes, lists, drafts).
// Risk "edit". Refuses any path that leaves the brain folder, also through a
// symlinked folder. Bigger file work goes to a helper (start_helper).
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { defineTool } from "../src/core/tool.ts";

const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

export default defineTool<{ path: string; content: string }>({
  name: "write_file",
  description:
    "Write a short text file in the user's notes folder: a quick note, a list, a draft. The path is relative to the notes " +
    "folder (e.g. projects/todo.md); an existing file is replaced. Not for code or files elsewhere: use start_helper.",
  risk: "edit",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path inside the notes folder, e.g. projects/shopping.md" },
      content: { type: "string", description: "The whole text of the file." },
    },
    required: ["path", "content"],
  },
  async run({ path, content }, { brainPath, brainWrote }) {
    const root = realpathSync(brainPath);
    const target = resolve(root, path);
    const refuse = () => new Error(`"${path}" is outside the notes folder: write_file only writes inside ${root}`);
    if (!inside(root, target)) throw refuse();
    // The nearest folder that exists must really be inside (no symlink out), and the file no symlink.
    let parent = dirname(target);
    while (!existsSync(parent)) parent = dirname(parent);
    const realParent = realpathSync(parent);
    if (realParent !== root && !inside(root, realParent)) throw refuse();
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw refuse();
    mkdirSync(dirname(target), { recursive: true });
    await writeFile(target, content);
    const rel = relative(root, target);
    brainWrote(rel);
    return { path: rel, bytes: Buffer.byteLength(content) };
  },
});
