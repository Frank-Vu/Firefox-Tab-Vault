(function attachFirefoxVault(globalObject) {
  'use strict';
  const core = typeof module !== 'undefined' && module.exports
    ? require('./core.js') : globalObject.TabVaultCore;

  function createFirefoxVault(api) {
    async function context(windowId) {
      if (!Number.isInteger(windowId)) throw new Error('The source window is missing. Reopen the extension.');
      const window = await api.windows.get(windowId);
      if (window.type !== 'normal') throw new Error('Open the extension in a normal Firefox browser window.');
      return window;
    }

    async function collect(scope, windowId) {
      const source = await context(windowId);
      const candidates = scope === 'all'
        ? await api.windows.getAll({ populate: true, windowTypes: ['normal'] })
        : [await api.windows.get(windowId, { populate: true })];
      const windows = [];
      for (const window of candidates
        .filter((item) => item.type === 'normal' && item.incognito === source.incognito)
        .sort((a, b) => Number(b.focused) - Number(a.focused))) {
        const groups = Object.create(null);
        const keys = new Map();
        const tabs = [...(window.tabs || [])].sort((a, b) => a.index - b.index);
        for (const group of await api.tabGroups.query({ windowId: window.id })) {
          const key = `g${keys.size + 1}`;
          keys.set(group.id, key);
          groups[key] = { title: group.title || '', color: group.color, collapsed: group.collapsed };
        }
        windows.push({
          state: window.state, focused: window.focused,
          left: window.left, top: window.top, width: window.width, height: window.height,
          groups,
          tabs: tabs.map((tab) => ({
            url: tab.pendingUrl || tab.url || 'about:blank', title: tab.title || '',
            pinned: tab.pinned, active: tab.active, muted: Boolean(tab.mutedInfo?.muted),
            discarded: tab.discarded, groupKey: keys.get(tab.groupId) || null,
            // Firefox has no autoDiscardable property. Keep the backup field for Chrome readers.
            autoDiscardable: true
          }))
        });
      }
      return core.normalizeArchive({
        exportedAt: new Date().toISOString(),
        source: { browser: 'Firefox', incognito: source.incognito,
          scope: scope === 'all' ? 'all-windows' : 'current-window' }, windows
      });
    }

    async function restoreWindow(data, windowId, placeholderId, activate, totals) {
      const existing = await api.tabs.query({ windowId });
      let pinnedIndex = existing.filter((tab) => tab.pinned).length;
      const entries = [];
      for (const tab of data.tabs) {
        try {
          const properties = { windowId, active: false, pinned: tab.pinned, muted: tab.muted };
          // Omitting url is Firefox's supported way to open the New Tab page.
          if (!['about:newtab', 'chrome://newtab/', 'chrome://newtab'].includes(tab.url)) {
            properties.url = tab.url;
          }
          if (tab.pinned) properties.index = pinnedIndex;
          if (tab.discarded) { properties.discarded = true; properties.title = tab.title; }
          const created = await api.tabs.create(properties);
          entries.push({ id: created.id, data: tab });
          if (tab.pinned) pinnedIndex += 1;
          totals.created += 1;
        } catch { totals.failed += 1; }
      }
      const attempt = async (operation) => {
        try { return await operation(); } catch { totals.warnings += 1; return null; }
      };
      if (placeholderId !== null && entries.length) await attempt(() => api.tabs.remove(placeholderId));
      const unpinned = entries.filter((entry) => !entry.data.pinned);
      // Newly created tabs can inherit an adjacent Firefox group's membership.
      if (unpinned.length) await attempt(() => api.tabs.ungroup(unpinned.map((entry) => entry.id)));
      const grouped = new Map();
      for (const entry of unpinned) {
        const key = entry.data.groupKey;
        if (!key) continue;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(entry.id);
      }
      const collapsed = [];
      for (const [key, tabIds] of grouped) {
        const group = data.groups[key];
        const groupId = await attempt(() => api.tabs.group({ tabIds, createProperties: { windowId } }));
        if (groupId === null) continue;
        totals.groups += 1;
        await attempt(() => api.tabGroups.update(groupId, {
          title: group.title, color: group.color, collapsed: false
        }));
        if (group.collapsed) collapsed.push(groupId);
      }
      const active = entries.find((entry) => entry.data.active) || entries[0];
      if (activate && active) await attempt(() => api.tabs.update(active.id, { active: true }));
      for (const groupId of collapsed) {
        await attempt(() => api.tabGroups.update(groupId, { collapsed: true }));
      }
    }

    async function restore(input, target, windowId) {
      const source = await context(windowId);
      const archive = core.normalizeArchive(input);
      const totals = { created: 0, failed: 0, groups: 0, warnings: 0 };
      if (target === 'current') {
        for (let index = 0; index < archive.windows.length; index += 1) {
          await restoreWindow(archive.windows[index], windowId, null,
            index === archive.windows.length - 1, totals);
        }
        return totals;
      }
      if (target !== 'new') throw new Error('Unknown restore destination.');
      const restored = [];
      for (const data of archive.windows) {
        let window;
        const bounds = Object.fromEntries(['left', 'top', 'width', 'height']
          .filter((key) => Number.isSafeInteger(data[key])).map((key) => [key, data[key]]));
        const properties = { url: 'about:blank', incognito: source.incognito, focused: false };
        try {
          window = await api.windows.create({ ...properties, ...bounds });
        } catch {
          // A backup may refer to a monitor that is no longer connected.
          totals.warnings += 1;
          if (!Object.keys(bounds).length) { totals.failed += data.tabs.length; continue; }
          try { window = await api.windows.create(properties); }
          catch { totals.failed += data.tabs.length; continue; }
        }
        const placeholder = window.tabs?.[0] || (await api.tabs.query({ windowId: window.id }))[0];
        await restoreWindow(data, window.id, placeholder?.id ?? null, true, totals);
        restored.push({ id: window.id, data });
      }
      const preferred = restored.find((entry) => entry.data.focused) || restored[0];
      for (const entry of restored) {
        try { await api.windows.update(entry.id, { state: entry.data.state }); }
        catch { totals.warnings += 1; }
      }
      if (preferred && preferred.data.state !== 'minimized') {
        try { await api.windows.update(preferred.id, { focused: true }); }
        catch { totals.warnings += 1; }
      }
      return totals;
    }

    async function download(content, filename, mimeType, windowId) {
      const source = await context(windowId);
      const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
      let id;
      const cleanup = () => { URL.revokeObjectURL(url); api.downloads.onChanged.removeListener(onChange); };
      const onChange = (change) => {
        if (change.id === id && ['complete', 'interrupted'].includes(change.state?.current)) cleanup();
      };
      api.downloads.onChanged.addListener(onChange);
      try {
        id = await api.downloads.download({ url, filename, saveAs: true, incognito: source.incognito });
        const [item] = await api.downloads.search({ id });
        if (item && ['complete', 'interrupted'].includes(item.state)) cleanup();
        return id;
      } catch (error) { cleanup(); throw error; }
    }
    return { collect, restore, download, context };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createFirefoxVault };
  else globalObject.TabVaultFirefox = { createFirefoxVault };
}(globalThis));
