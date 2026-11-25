// One directory source for Files, Changes, the top bar and terminal actions.
// A space's creation folder is only a last resort: it can belong to another repo.
import { spaces, panes, focused, shared, setShared } from "herdr";

const KEY = "2code.contexts";
const contexts = () => shared(KEY) ?? {};
const normalize = (path) => String(path ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
const within = (path, root) => {
  const p = normalize(path), r = normalize(root);
  return Boolean(r && (p === r || p.startsWith(r + "/")));
};

// Remember only this space, never a peek or a terminal belonging to another space.
export function rememberLocation(space, { cwd, on = space?.machine ?? null, branch = null }) {
  if (!space || !cwd) return;
  const all = contexts(), previous = all[space.id];
  if (previous?.cwd === cwd && previous.on === on && previous.branch === branch) return;
  const live = new Set(spaces().map((s) => s.id));
  const next = Object.fromEntries(Object.entries(all).filter(([id]) => live.has(id)));
  setShared(KEY, { ...next, [space.id]: { cwd, on, branch } });
}

export function currentLocation() {
  const space = spaces().find((s) => s.active);
  if (!space) return { space: null, cwd: null, on: null, branch: null };
  const tab = space.tabs.find((t) => t.active), f = focused();
  const tabs = new Set(space.tabs.map((t) => t.id));
  const mine = panes().filter((p) => tabs.has(p.tab));
  const pane = f?.space === space.id && f?.tab === tab?.id
    ? mine.find((p) => p.pane === f.pane && p.tab === tab.id) : null;
  const previous = contexts()[space.id];
  const editor = (shared("2code.editors") ?? {})[tab?.id];
  let cwd, branch = null, on = space.machine ?? null;

  if (pane?.terminal && pane.cwd) {
    cwd = pane.cwd;
    branch = pane.branch ?? null;
  } else if (editor?.path) {
    on = editor.on ?? space.machine ?? null;
    // Old tabs may predate the root field; retain a matching directory until
    // their editor republishes the root from its saved pane props.
    cwd = editor.root
      || (previous?.on === on && within(editor.path, previous.cwd) ? previous.cwd : null)
      || editor.path.replace(/[\\/][^\\/]+$/, "");
    const lead = mine.find((p) => p.terminal && within(p.cwd, cwd));
    branch = lead?.branch ?? (previous?.cwd === cwd && previous.on === on ? previous.branch : null);
  } else {
    const lead = mine.find((p) => p.tab === tab?.id && p.terminal && p.cwd);
    const remembered = previous?.on === on ? previous : null;
    const fallback = mine.find((p) => p.terminal && p.cwd);
    cwd = lead?.cwd || remembered?.cwd || fallback?.cwd || space.folder || null;
    branch = (lead ? lead.branch : remembered ? remembered.branch : fallback?.branch) ?? null;
  }

  rememberLocation(space, { cwd, on, branch });
  return { space, cwd, on, branch };
}
