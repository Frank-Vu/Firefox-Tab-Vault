'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFirefoxVault } = require('../firefox.js');

function fakeFirefox() {
  const windows = new Map();
  const tabs = new Map();
  const groups = new Map();
  let nextId = 1;
  const list = (id) => [...tabs.values()].filter((tab) => tab.windowId === id).sort((a, b) => a.index - b.index);
  const reindex = (items) => items.forEach((tab, index) => { tab.index = index; });
  const api = {
    windows: {
      get: async (id, options = {}) => {
        const window = windows.get(id);
        if (!window) throw new Error('Window closed');
        return { ...window, ...(options.populate ? { tabs: list(id) } : {}) };
      },
      getAll: async () => [...windows.values()].map((window) => ({ ...window, tabs: list(window.id) })),
      create: async (properties) => {
        const window = { id: nextId++, type: 'normal', state: 'normal', focused: false, incognito: false, ...properties };
        windows.set(window.id, window);
        const tab = await api.tabs.create({ windowId: window.id, url: properties.url, active: true });
        return { ...window, tabs: [tab] };
      },
      update: async (id, properties) => Object.assign(windows.get(id), properties)
    },
    tabs: {
      query: async ({ windowId }) => list(windowId),
      create: async (properties) => {
        assert.equal(Object.hasOwn(properties, 'autoDiscardable'), false);
        if (/^(javascript:|chrome:|moz-extension:|about:config)/.test(properties.url || '')) throw new Error('Blocked URL');
        const tab = { id: nextId++, pinned: false, active: false, discarded: false, groupId: -1, ...properties };
        tab.mutedInfo = { muted: Boolean(properties.muted) };
        if (tab.url === undefined) tab.url = 'about:newtab';
        const items = list(tab.windowId);
        items.splice(properties.index ?? items.length, 0, tab);
        reindex(items);
        tabs.set(tab.id, tab);
        return tab;
      },
      remove: async (id) => { const tab = tabs.get(id); tabs.delete(id); reindex(list(tab.windowId)); },
      update: async (id, properties) => {
        assert.equal(Object.hasOwn(properties, 'autoDiscardable'), false);
        const tab = tabs.get(id);
        if (properties.active) {
          list(tab.windowId).forEach((item) => { item.active = false; });
          tab.discarded = false;
        }
        return Object.assign(tab, properties);
      },
      ungroup: async (ids) => ids.forEach((id) => { tabs.get(id).groupId = -1; }),
      group: async ({ tabIds, createProperties }) => {
        const id = nextId++;
        groups.set(id, { id, windowId: createProperties.windowId, title: '', color: 'grey', collapsed: false });
        tabIds.forEach((tabId) => { tabs.get(tabId).groupId = id; });
        return id;
      }
    },
    tabGroups: {
      query: async ({ windowId }) => [...groups.values()].filter((group) => group.windowId === windowId),
      update: async (id, properties) => Object.assign(groups.get(id), properties)
    }
  };
  return { api, windows, tabs, groups, list, vault: createFirefoxVault(api) };
}

const fixture = {
  source: { incognito: true }, windows: [{
    left: -30, top: 20, width: 900, height: 700, focused: true, state: 'maximized',
    groups: { research: { title: 'Research', color: 'purple', collapsed: true } },
    tabs: [
      { url: 'https://example.org/pinned', pinned: true },
      { url: 'https://example.org/active', active: true, muted: true, groupKey: 'research' },
      { url: 'https://example.org/sleeping', discarded: true, title: 'Sleeping', groupKey: 'research' },
      { url: 'https://example.org/last' }
    ]
  }]
};

test('all-window export isolates private and normal contexts and preserves metadata', async () => {
  const f = fakeFirefox();
  const normal = await f.api.windows.create({ incognito: false });
  const privateWindow = await f.api.windows.create({ incognito: true });
  await f.vault.restore(fixture, 'current', privateWindow.id);
  const normalArchive = await f.vault.collect('all', normal.id);
  const privateArchive = await f.vault.collect('all', privateWindow.id);
  assert.equal(normalArchive.windows.length, 1);
  assert.equal(normalArchive.windows[0].tabs.some((tab) => tab.url.includes('/sleeping')), false);
  assert.equal(privateArchive.windows.length, 1);
  assert.equal(privateArchive.source.incognito, true);
  assert.equal(privateArchive.windows[0].tabs.find((tab) => tab.url.includes('/sleeping')).discarded, true);
  assert.equal(Object.values(privateArchive.windows[0].groups)[0].title, 'Research');
});

test('new-window restore preserves order, groups, states, bounds, and destination mode', async () => {
  const f = fakeFirefox();
  const source = await f.api.windows.create({ incognito: false });
  const result = await f.vault.restore(fixture, 'new', source.id);
  assert.deepEqual(result, { created: 4, failed: 0, groups: 1, warnings: 0 });
  const window = [...f.windows.values()][1];
  assert.equal(window.incognito, false); // Backup mode does not decide the destination.
  assert.equal(window.state, 'maximized');
  assert.equal(window.left, -30);
  assert.equal(window.width, 900);
  const tabs = f.list(window.id);
  assert.deepEqual(tabs.map((tab) => tab.url), fixture.windows[0].tabs.map((tab) => tab.url));
  assert.equal(tabs[0].pinned, true);
  assert.equal(tabs[1].mutedInfo.muted, true);
  assert.equal(tabs[1].active, true);
  assert.equal(tabs[2].discarded, true);
  assert.equal(tabs[2].title, 'Sleeping');
  assert.equal(tabs[1].groupId, tabs[2].groupId);
  const group = f.groups.get(tabs[1].groupId);
  assert.equal(group.title, 'Research');
  assert.equal(group.color, 'purple');
  assert.equal(group.collapsed, true);
});

test('append preserves existing tabs and groups and inserts pins after existing pins', async () => {
  const f = fakeFirefox();
  const window = await f.api.windows.create({ incognito: true });
  const pinned = await f.api.tabs.create({ windowId: window.id, url: 'https://existing.test/pin', pinned: true, index: 0 });
  const groupId = await f.api.tabs.group({ tabIds: [window.tabs[0].id], createProperties: { windowId: window.id } });
  await f.vault.restore(fixture, 'current', window.id);
  const tabs = f.list(window.id);
  assert.equal(tabs.length, 6);
  assert.equal(tabs[0].id, pinned.id);
  assert.equal(tabs[1].url, fixture.windows[0].tabs[0].url);
  assert.equal(f.tabs.get(window.tabs[0].id).groupId, groupId);
  assert.equal(f.windows.size, 1);
});

test('restricted URLs are reported without interrupting later tabs; new-tab URLs are translated', async () => {
  const f = fakeFirefox();
  const source = await f.api.windows.create({});
  const result = await f.vault.restore({ windows: [{ tabs: ['about:config', 'javascript:alert(1)', 'chrome://newtab/', 'about:newtab', 'https://example.org/ok'] }] }, 'new', source.id);
  assert.deepEqual(result, { created: 3, failed: 2, groups: 0, warnings: 0 });
  assert.deepEqual(f.list([...f.windows.keys()][1]).map((tab) => tab.url), ['about:newtab', 'about:newtab', 'https://example.org/ok']);
});

test('group or window-state failures produce visible warnings while preserving tabs', async () => {
  const f = fakeFirefox();
  const source = await f.api.windows.create({});
  f.api.tabGroups.update = async () => { throw new Error('Unavailable'); };
  f.api.windows.update = async () => { throw new Error('Unavailable'); };
  const result = await f.vault.restore(fixture, 'new', source.id);
  assert.equal(result.created, 4);
  assert.equal(result.warnings, 4);
});

test('closed source windows abort before restoration and invalid destinations are rejected', async () => {
  const f = fakeFirefox();
  await assert.rejects(f.vault.restore(fixture, 'new', 999), /Window closed/);
  assert.equal(f.windows.size, 0);
  const window = await f.api.windows.create({});
  await assert.rejects(f.vault.restore(fixture, 'invalid', window.id), /destination/);
});

test('unavailable window geometry falls back to default bounds without losing tabs', async () => {
  const f = fakeFirefox();
  const source = await f.api.windows.create({});
  const create = f.api.windows.create;
  f.api.windows.create = async (properties) => {
    if ('left' in properties) throw new Error('Monitor unavailable');
    return create(properties);
  };
  const result = await f.vault.restore(fixture, 'new', source.id);
  assert.equal(result.created, 4);
  assert.equal(result.failed, 0);
  assert.equal(result.warnings, 1);
});

test('multiple archived windows append in sequence with the final archived active tab selected', async () => {
  const f = fakeFirefox();
  const window = await f.api.windows.create({});
  const archive = { windows: [
    { tabs: [{ url: 'https://example.org/a', active: true }] },
    { tabs: [{ url: 'https://example.org/b' }, { url: 'https://example.org/c', active: true }] }
  ] };
  await f.vault.restore(archive, 'current', window.id);
  assert.deepEqual(f.list(window.id).map((tab) => tab.url), ['about:newtab', 'https://example.org/a', 'https://example.org/b', 'https://example.org/c']);
  assert.equal(f.list(window.id).find((tab) => tab.active).url, 'https://example.org/c');
});

test('all failed tabs leave a usable placeholder; minimized windows stay minimized', async () => {
  const f = fakeFirefox();
  const source = await f.api.windows.create({});
  const result = await f.vault.restore({ windows: [{ state: 'minimized', focused: true, tabs: ['about:config'] }] }, 'new', source.id);
  assert.equal(result.failed, 1);
  const window = [...f.windows.values()][1];
  assert.equal(window.state, 'minimized');
  assert.equal(window.focused, false);
  assert.equal(f.list(window.id).length, 1);
});

test('downloads use private context and retain the blob until completion', async () => {
  const f = fakeFirefox();
  const source = await f.api.windows.create({ incognito: true });
  const listeners = new Set();
  let options;
  f.api.downloads = {
    onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
    download: async (input) => { options = input; return 42; },
    search: async () => [{ state: 'in_progress' }]
  };
  await f.vault.download('backup data', 'backup.json', 'application/json', source.id);
  assert.equal(options.incognito, true);
  assert.equal(options.saveAs, true);
  assert.equal(await (await fetch(options.url)).text(), 'backup data');
  for (const listener of listeners) listener({ id: 42, state: { current: 'complete' } });
  assert.equal(listeners.size, 0);
  await assert.rejects(fetch(options.url));
});
