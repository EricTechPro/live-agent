// Past chats for the sidebar (ticket 24): the chat-end notes already in raw,
// newest first, each with a short title and its time. Read only.
//
//   await pastChats(root, folders)   // [{ path: "raw/2026-11-15-chat-2.md", title, date }]
//   await deleteChat(root, "raw/2026-11-15-chat-2.md", folders)   // the panel's delete
//
// A chat-end note is `<raw>/YYYY-MM-DD-chat[-n].md` (saveChatNote via saveRawNote).
// Order comes from the name (day, then n), not file times, which copies and
// syncs change. Symlinks are skipped, so the list never reads outside the brain;
// reading one note goes through readBrainFile (src/brain/tree.ts) like the tree.
import { lstat, open, readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_FOLDERS, type BrainFolders } from "./index.ts";

export interface PastChat {
  /** Inside the brain, forward slashes: what GET /brain/file takes. */
  path: string;
  title: string;
  /** ISO time the note was written (its file time). */
  date: string;
}

/** The list stops at this many chats. */
export const MAX_CHATS = 200;
const TITLE_MAX = 60;
const HEAD_BYTES = 4096;
const CHAT_NOTE = /^(\d{4}-\d{2}-\d{2})-chat(?:-(\d+))?\.md$/;

export async function pastChats(root: string, folders: BrainFolders = DEFAULT_FOLDERS): Promise<PastChat[]> {
  const raw = folders.raw;
  let entries;
  try {
    entries = await readdir(join(root, raw), { withFileTypes: true });
  } catch {
    return []; // no raw folder yet: no chats yet
  }
  const notes = entries
    .filter((e) => e.isFile()) // Dirent.isFile() is false for a symlink
    .map((e) => ({ name: e.name, m: CHAT_NOTE.exec(e.name) }))
    .filter((n): n is { name: string; m: RegExpExecArray } => !!n.m)
    .sort((a, b) => b.m[1]!.localeCompare(a.m[1]!) || Number(b.m[2] ?? 1) - Number(a.m[2] ?? 1))
    .slice(0, MAX_CHATS);

  return Promise.all(
    notes.map(async ({ name }) => {
      const file = join(root, raw, name);
      const [info, head] = await Promise.all([stat(file), readHead(file)]);
      return { path: `${raw}/${name}`, title: titleOf(head), date: info.mtime.toISOString() };
    }),
  );
}

async function readHead(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** The note's first line under its `# Chat, 15 Nov` heading, bullet and speaker dropped, cut short. */
function titleOf(text: string): string {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#"));
  const title = (line ?? "").replace(/^[-*•]\s+/, "").replace(/^(You|Agent):\s*/, "").replace(/\*\*/g, "").trim();
  if (!title) return "Chat";
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title;
}

/** A delete the core refuses: not a chat-end note straight in raw, or not a plain file. */
export class ChatPathError extends Error {}

/**
 * Delete one past chat (the panel's per-row delete). Only a chat-end note straight inside
 * the raw folder (`<raw>/YYYY-MM-DD-chat[-n].md`, the shape pastChats lists) and only a
 * plain file, never a symlink, so nothing outside those notes can go. Wiki pages the tidy
 * job already made from it stay. Resolves false when the note was already gone.
 */
export async function deleteChat(root: string, path: string, folders: BrainFolders = DEFAULT_FOLDERS): Promise<boolean> {
  const prefix = `${folders.raw}/`;
  const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
  if (!CHAT_NOTE.test(name)) throw new ChatPathError(`${path} is not a past chat`);
  const file = join(root, folders.raw, name);
  let info;
  try {
    info = await lstat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) throw new ChatPathError(`${path} is not a plain note`);
  await unlink(file);
  return true;
}
