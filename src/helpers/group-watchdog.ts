// A watchdog that stops a helper's whole process group if the core dies hard.
//
//   const stop = watchGroup(proc.pid);   // right after spawning the helper (detached)
//   ...
//   stop();                              // the helper ended normally
//
// Why: a helper CLI runs in its own process group (so cancel can stop it and
// everything it started). That also means nothing stops it if the core is
// killed with kill -9 or crashes: no exit hook runs, and the helper keeps
// editing files with nobody watching. A tiny `sh` loop outside the group polls
// the core's PID and, once it is gone, stops the group: SIGTERM, then SIGKILL.
//
// Why a separate process (not a wrapper around the CLI): a non-interactive sh
// starts background children with SIGINT ignored, which would break the clean
// SIGINT cancel. The watchdog only watches; the CLI is spawned exactly as before.

const SCRIPT =
  'core=$1; group=$2; ' +
  // Poll while both the core and the helper's group are alive.
  'while kill -0 "$core" 2>/dev/null && kill -0 -"$group" 2>/dev/null; do sleep 1; done; ' +
  // The core is gone but the helper is not: stop the group.
  'if kill -0 -"$group" 2>/dev/null; then kill -TERM -"$group" 2>/dev/null; sleep 2; kill -KILL -"$group" 2>/dev/null; fi';

/** Stop process group `group` if this process dies. Returns a function that ends the watch. */
export function watchGroup(group: number): () => void {
  if (process.platform === "win32") return () => {}; // no sh; cancel and session.close() still stop it
  // detached: its own group, so the TERM it sends never hits itself.
  const dog = Bun.spawn(["sh", "-c", SCRIPT, "sh", String(process.pid), String(group)], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  dog.unref(); // never keeps the core alive
  return () => {
    try {
      dog.kill("SIGKILL");
    } catch {}
  };
}
