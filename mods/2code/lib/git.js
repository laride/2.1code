import { panes, exec } from "herdr";
import { currentLocation } from "./context.js";

// Reads write nothing under .git, so a folder watch never feeds itself.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

export async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout ? { timeout } : {}) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr || r.stdout || "").trim() };
}

// Where a space is now: its first terminal's live folder, else where it was made.
export function place(space, all = panes()) {
  if (!space) return null;
  const tabs = new Set((space.tabs ?? []).map((t) => t.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || null;
}

// The repo a folder belongs to: its main checkout, this checkout's root and name.
export async function repoOf(folder, on) {
  if (!folder) return null;
  const r = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], on);
  if (!r.ok) return null;
  const [common, top] = r.out.split("\n");
  const main = common.endsWith("/.git") ? common.slice(0, -5) : common;
  return { main, top, name: main.split("/").pop(), linked: main !== top };
}

// All project UI uses the same space-scoped directory, including file tabs.
export const here = currentLocation;
