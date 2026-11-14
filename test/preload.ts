// Runs before every `bun test` (see bunfig.toml), fast tests and live smoke alike.
//
// Why: closing a session writes a chat-end note into the brain's raw/ folder,
// and the default config's brain is the repo's `sample-brain` (relative to the
// working folder). So tests run from a throwaway folder holding a copy of the
// sample brain: every test can use the defaults and the repo stays clean.
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "live-agent-test-"));
cpSync(join(repo, "sample-brain"), join(scratch, "sample-brain"), { recursive: true });
process.chdir(scratch);
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
