import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../mods/2code/lib/', import.meta.url));
const A = '/work/project-a', B = '/work/project-b', WT = '/work/worktree-a';
let world, state, writes, commands;
function reset() {
  world = {
    spaces: [{ id: 'a', active: true, folder: B, machine: null, tabs: [
      { id: 'terminal-a', active: true, name: '1' },
      { id: 'other-worktree', active: false, name: '2' },
    ] }],
    panes: [
      { pane: 'pa', tab: 'terminal-a', terminal: 't1', cwd: A, branch: 'main' },
      { pane: 'pwt', tab: 'other-worktree', terminal: 't2', cwd: WT, branch: 'feature' },
    ],
    focused: { space: 'a', tab: 'terminal-a', pane: 'pa', terminal: 't1', cwd: A },
  };
  state = {}; writes = 0; commands = [];
}
function select(spaceId, tabId, paneId) {
  for (const s of world.spaces) {
    s.active = s.id === spaceId;
    if (s.active) for (const t of s.tabs) t.active = t.id === tabId;
  }
  const p = world.panes.find(p => p.pane === paneId);
  world.focused = { space: spaceId, tab: tabId, pane: paneId, terminal: p?.terminal ?? null, cwd: p?.cwd ?? null };
}
const host = {
  spaces: () => structuredClone(world.spaces),
  panes: () => structuredClone(world.panes),
  focused: () => structuredClone(world.focused),
  shared: k => structuredClone(state[k]),
  setShared: (k, v) => { state[k] = structuredClone(v); writes++; },
  run: (cmd, args) => {
    commands.push({ cmd, args });
    if (cmd === 'tab.new') {
      const space = world.spaces.find(s => s.id === args.space);
      space.tabs.push({ id: 'editor-new', name: args.name, active: false });
      world.panes.push({ pane: 'editor-pane', tab: 'editor-new', terminal: null, cwd: null });
      select(space.id, 'editor-new', 'editor-pane');
    }
  },
};
const context = vm.createContext({ console });
const herdr = new vm.SyntheticModule(Object.keys(host), function () {
  for (const [key, value] of Object.entries(host)) this.setExport(key, value);
}, { context });
const directory = new vm.SourceTextModule(fs.readFileSync(`${root}/context.js`, 'utf8'), { context });
await directory.link(name => { assert.equal(name, 'herdr'); return herdr; });
await directory.evaluate();
const editors = new vm.SourceTextModule(fs.readFileSync(`${root}/editor.js`, 'utf8'), { context });
await editors.link(name => name === 'herdr' ? herdr : directory);
await editors.evaluate();
const { currentLocation, rememberLocation } = directory.namespace;
const { openFile, registerEditor } = editors.namespace;
const cx = { sleep: async () => {} };
let tests = 0;
function check(name, fn) {
  reset(); fn(); tests++; console.log(`PASS ${name}`);
}

check('terminal cwd overrides an unrelated space creation folder', () => {
  assert.equal(currentLocation().cwd, A);
});

reset(); currentLocation();
await openFile(cx, { space: 'a', path: `${A}/README.md`, root: A });
assert.equal(currentLocation().cwd, A);
assert.equal(state['2code.editors']['editor-new'].root, A);
assert.equal(world.focused.terminal, null);
tests++; console.log('PASS opening a real editor tab retains its source directory');

check('restored editor root wins over a different first terminal and creation folder', () => {
  world.spaces[0].tabs.push({ id: 'editor', active: false });
  world.panes.push({ pane: 'ed', tab: 'editor', terminal: null, cwd: null });
  registerEditor('editor', { path: `${WT}/src/a.js`, on: null, root: WT });
  select('a', 'editor', 'ed');
  assert.equal(currentLocation().cwd, WT);
  assert.equal(currentLocation().branch, 'feature');
});

check('closing every terminal preserves an open file root', () => {
  world.spaces[0].tabs = [{ id: 'editor', active: true }];
  world.panes = [{ pane: 'ed', tab: 'editor', terminal: null, cwd: null }];
  registerEditor('editor', { path: `${A}/src/a.js`, root: A });
  select('a', 'editor', 'ed');
  assert.equal(currentLocation().cwd, A);
});

check('legacy editor metadata retains a matching remembered directory', () => {
  currentLocation();
  world.spaces[0].tabs.push({ id: 'editor', active: false });
  state['2code.editors'] = { editor: { path: `${A}/src/a.js`, on: null } };
  select('a', 'editor', 'ed');
  assert.equal(currentLocation().cwd, A);
  registerEditor('editor', { path: `${A}/src/a.js`, on: null, root: A });
  assert.equal(state['2code.editors'].editor.root, A);
});

check('a peek in another project does not redirect the active file panel', () => {
  currentLocation();
  world.focused = { space: 'a', tab: 'terminal-a', pane: null, terminal: 'other/t9', cwd: B };
  assert.equal(currentLocation().cwd, A);
  assert.equal(currentLocation().on, null);
});

check('switching spaces keeps their remembered contexts separate', () => {
  currentLocation();
  world.spaces.push({ id: 'b', active: false, folder: '/home/user', machine: null, tabs: [{ id: 'tb', active: true }] });
  world.panes.push({ pane: 'pb', tab: 'tb', terminal: 't3', cwd: B, branch: 'dev' });
  select('b', 'tb', 'pb');
  assert.equal(currentLocation().cwd, B);
  select('a', 'terminal-a', 'pa');
  assert.equal(currentLocation().cwd, A);
});

check('same-space worktree selection follows the selected terminal', () => {
  currentLocation();
  select('a', 'other-worktree', 'pwt');
  assert.equal(currentLocation().cwd, WT);
  assert.equal(currentLocation().branch, 'feature');
});

check('a terminal deliberately changing to home is still respected', () => {
  currentLocation();
  world.panes[0].cwd = '/home/user'; world.panes[0].branch = null;
  assert.equal(currentLocation().cwd, '/home/user');
  assert.equal(currentLocation().branch, null);
});

check('remote file tabs retain both their directory and machine', () => {
  world.spaces[0].machine = 'server';
  world.spaces[0].tabs.push({ id: 'editor', active: false });
  registerEditor('editor', { path: '/srv/worktree/a.js', root: '/srv/worktree', on: 'server' });
  select('a', 'editor', 'ed');
  assert.equal(currentLocation().cwd, '/srv/worktree');
  assert.equal(currentLocation().on, 'server');
});

check('repeated context reads do not trigger redraw loops', () => {
  currentLocation(); const before = writes;
  for (let i = 0; i < 10; i++) currentLocation();
  assert.equal(writes, before);
});

check('empty windows have no invented project directory', () => {
  world.spaces = []; world.panes = []; world.focused = null;
  assert.equal(currentLocation().cwd, null);
  assert.equal(writes, 0);
});

reset();
await openFile(cx, { space: 'closed-space', path: `${B}/README.md`, root: B });
assert.equal(commands.length, 0);
tests++; console.log('PASS a delayed click for a closed space cannot open in another project');

reset();
world.spaces[0].tabs.push({ id: 'existing', name: 'README.md', active: false });
registerEditor('existing', { path: `${A}/README.md`, on: null });
await openFile(cx, { space: 'a', path: `${A}/README.md`, root: A });
assert.equal(state['2code.editors'].existing.root, A);
assert.equal(commands[0].cmd, 'tab.select');
tests++; console.log('PASS reopening an existing file upgrades its directory metadata');

console.log(`${tests} regression scenarios passed`);
