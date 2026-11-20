// Duck the Mac while you talk (config `duckWhileTalking`): other sounds go quiet while push
// to talk is held, and come back to the exact level after.
//
//   const duck = createDuck({ volume: macVolume(), stateFile: join(home, ".duck.json") });
//   await duck.recover();   // at start: a crash left the Mac quiet? put it back
//   await duck.set(true);   // push to talk pressed
//   await duck.set(false);  // let go
//
// Why the system output volume (not per app): per-app volume needs an audio driver. Jett's
// own voice is not playing while you hold the keys, so turning the whole Mac down is fine.
// The level before is written to a small file first, so a crash or a quit mid-hold still
// gets it back (recover on the next start, restore on close).
import { readFile, rm, writeFile } from "node:fs/promises";
import { run } from "./screen/eyes.ts";

/** The Mac's output volume, 0 to 100. */
export interface Volume {
  get(): Promise<number | undefined>;
  set(level: number): Promise<void>;
}

/** The real one: AppleScript's output volume (no permission needed). */
export function macVolume(): Volume {
  return {
    async get() {
      const { out, code } = await run(["osascript", "-e", "output volume of (get volume settings)"], 2000);
      const n = Number(out.trim());
      return code === 0 && Number.isFinite(n) ? n : undefined;
    },
    async set(level) {
      await run(["osascript", "-e", `set volume output volume ${Math.round(Math.max(0, Math.min(100, level)))}`], 2000);
    },
  };
}

export interface Duck {
  /** Quiet (true) or back to the level before (false). Calls run in order. */
  set(on: boolean): Promise<void>;
  /** Put back a level a crash left behind (the state file). */
  recover(): Promise<void>;
}

export function createDuck({ volume, stateFile, quiet = 0.15 }: { volume: Volume; stateFile: string; quiet?: number }): Duck {
  let before: number | undefined;
  let chain = Promise.resolve();
  const later = (step: () => Promise<void>) => (chain = chain.then(step).catch(() => {}));
  async function restore(level: number) {
    await volume.set(level);
    await rm(stateFile, { force: true });
  }
  return {
    set(on) {
      return later(async () => {
        if (on && before === undefined) {
          const now = await volume.get();
          if (now === undefined || now === 0) return;
          await writeFile(stateFile, JSON.stringify({ volume: now }));
          before = now;
          await volume.set(Math.round(now * quiet));
        } else if (!on && before !== undefined) {
          const level = before;
          before = undefined;
          await restore(level);
        }
      });
    },
    recover() {
      return later(async () => {
        let saved: unknown;
        try {
          saved = JSON.parse(await readFile(stateFile, "utf8")).volume;
        } catch {
          return;
        }
        if (typeof saved === "number") await restore(saved);
        else await rm(stateFile, { force: true });
      });
    },
  };
}
