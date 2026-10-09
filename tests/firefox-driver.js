/* Runs only inside the temporary integration-test extension. */
'use strict';
(async () => {
  const passed = [];
  const failures = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const run = async (name, fn) => {
    try { await fn(); passed.push(name); }
    catch (error) { failures.push({ name, error: error.message, stack: error.stack }); }
  };
  const api = browser;
  const waitLoaded = async (windowId) => {
    for (let n = 0; n < 200; n += 1) {
      const tabs = await api.tabs.query({ windowId });
      if (tabs.every((tab) => tab.discarded || (tab.status === 'complete' && tab.url.startsWith(TEST_BASE)))) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('Local fixture pages did not finish loading');
  };
  const adapter = globalThis.TabVaultFirefox.createFirefoxVault(api);
  let normal;
  let privateWindow;
  let snapshot;
  try {
    const info = await browser.runtime.getBrowserInfo();
    await run('native tab groups, pins, mute and discarded state export', async () => {
      normal = await api.windows.create({ url: `${TEST_BASE}/normal`, focused: false, width: 920, height: 720 });
      await api.tabs.create({ windowId: normal.id, url: `${TEST_BASE}/normal-pin`, pinned: true, active: false });
      const active = await api.tabs.create({ windowId: normal.id, url: `${TEST_BASE}/normal-active`, muted: true, active: true });
      const sleeping = await api.tabs.create({ windowId: normal.id, url: `${TEST_BASE}/normal-sleep`, discarded: true, title: 'Sleeping fixture', active: false });
      const groupId = await api.tabs.group({ tabIds: [active.id, sleeping.id], createProperties: { windowId: normal.id } });
      await api.tabGroups.update(groupId, { title: 'Native research 🦊', color: 'purple', collapsed: true });
      await waitLoaded(normal.id);
      snapshot = await adapter.collect('current', normal.id);
      const tabs = snapshot.windows[0].tabs;
      assert(tabs[0].pinned, 'Pin was lost');
      assert(tabs.find((tab) => tab.url.endsWith('normal-active')).muted, 'Mute was lost');
      assert(tabs.find((tab) => tab.url.endsWith('normal-sleep')).discarded, 'Discarded state was lost');
      const group = Object.values(snapshot.windows[0].groups)[0];
      assert(group.title === 'Native research 🦊' && group.collapsed && group.color === 'purple', 'Group metadata was lost');
      assert(snapshot.windows[0].width === 920 && snapshot.windows[0].height === 720, 'Window dimensions were lost');
    });
    await run('native new-window restore with order and metadata', async () => {
      const before = new Set((await api.windows.getAll()).map((window) => window.id));
      const result = await adapter.restore(snapshot, 'new', normal.id);
      assert(result.created === 4 && result.groups === 1 && result.failed === 0 && result.warnings === 0,
        `Unexpected restore result: ${JSON.stringify(result)}`);
      const restoredWindow = (await api.windows.getAll()).find((window) => !before.has(window.id));
      await waitLoaded(restoredWindow.id);
      const restored = await adapter.collect('current', restoredWindow.id);
      assert(JSON.stringify(restored.windows[0].tabs) === JSON.stringify(snapshot.windows[0].tabs),
        `Restored metadata differs: ${JSON.stringify(restored.windows[0].tabs)}`);
      assert(JSON.stringify(restored.windows[0].groups) === JSON.stringify(snapshot.windows[0].groups), 'Group changed');
      assert(restored.windows[0].width === 920, 'Width was not restored');
      await api.windows.remove(restoredWindow.id);
    });
    await run('private-window access and all-window isolation', async () => {
      assert(await api.extension.isAllowedIncognitoAccess(), 'Test extension lacks private-window access');
      privateWindow = await api.windows.create({ url: `${TEST_BASE}/private`, incognito: true, focused: false });
      await waitLoaded(privateWindow.id);
      const normalArchive = await adapter.collect('all', normal.id);
      const privateArchive = await adapter.collect('all', privateWindow.id);
      assert(normalArchive.windows.every((window) => window.tabs.every((tab) => !tab.url.includes('/private'))), 'Private tab leaked into normal export');
      assert(privateArchive.windows.length === 1 && privateArchive.source.incognito, 'Private export was not isolated');
      assert(privateArchive.windows[0].tabs[0].url.includes('/private'), 'Wrong private tab exported');
      const before = new Set((await api.windows.getAll()).map((window) => window.id));
      const result = await adapter.restore(snapshot, 'new', privateWindow.id);
      assert(result.created === 4 && result.failed === 0, 'Private restore failed');
      const restoredWindow = (await api.windows.getAll()).find((window) => !before.has(window.id));
      assert(restoredWindow.incognito, 'Private restore escaped into normal window');
      await api.windows.remove(restoredWindow.id);
    });
    await run('restricted URLs report failures while permitted tabs restore', async () => {
      const result = await adapter.restore({ tabs: ['about:config', 'javascript:alert(1)', 'chrome://settings/', 'about:newtab', `${TEST_BASE}/permitted`] }, 'current', normal.id);
      assert(result.created === 2 && result.failed === 3, `Unexpected blocked URL result: ${JSON.stringify(result)}`);
    });
    await run('Firefox Web Crypto decrypts upstream Chrome JSON and TXT fixtures', async () => {
      for (const format of ['json', 'txt']) {
        const encrypted = await (await fetch(api.runtime.getURL(`fixtures/chrome-encrypted.${format}`))).text();
        const expected = await (await fetch(api.runtime.getURL(`fixtures/chrome.${format}`))).text();
        const result = await TabVaultCrypto.decryptBackupContent(TabVaultCrypto.parseEncryptedEnvelope(encrypted), 'tab-vault-fixture-password');
        assert(result.plaintext === expected, `Chrome ${format} decryption failed`);
      }
    });
    const waitUI = async (windowId, mode) => {
      let done;
      const completed = new Promise((resolve) => { done = resolve; });
      let verifyBackground = false;
      const listener = (message) => {
        if (message?.channel !== 'test-ui' || message.mode !== mode) return;
        if (message.type === 'config') return Promise.resolve({ base: TEST_BASE, mode });
        if (message.type === 'closing') { verifyBackground = true; return Promise.resolve({}); }
        if (message.type === 'done') { done(message); return Promise.resolve({}); }
      };
      api.runtime.onMessage.addListener(listener);
      const tab = await api.tabs.create({ windowId, url: api.runtime.getURL(`popup.html?test=${mode}`), active: true });
      let timer;
      try {
        const result = await Promise.race([completed, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('UI test timed out')), 30000);
        })]);
        passed.push(...result.passed);
        failures.push(...result.failures);
        if (verifyBackground) {
          let restored;
          for (let n = 0; n < 300; n += 1) {
            const candidates = await api.windows.getAll({ populate: true });
            restored = candidates.find((window) => window.tabs.filter((tab) => tab.url?.includes(`/${mode}-background-`)).length === 15);
            if (restored) break;
            await new Promise((resolve) => setTimeout(resolve, 30));
          }
          assert(restored, 'Restore stopped when initiating page closed');
          assert(restored.incognito === (mode === 'private'), 'Background restore changed privacy mode');
          passed.push(`${mode}: background restore survives initiating page closure`);
          await api.windows.remove(restored.id);
        }
      } finally {
        clearTimeout(timer);
        api.runtime.onMessage.removeListener(listener);
        try { await api.tabs.remove(tab.id); } catch {}
      }
    };
    await run('normal extension UI', () => waitUI(normal.id, 'normal'));
    if (privateWindow) await run('private extension UI', () => waitUI(privateWindow.id, 'private'));
    await fetch(`${TEST_BASE}/report`, { method: 'POST', body: JSON.stringify({ browser: info, passed, failures }) });
  } catch (error) {
    failures.push({ name: 'Firefox harness setup', error: error.message, stack: error.stack });
    await fetch(`${TEST_BASE}/report`, { method: 'POST', body: JSON.stringify({ passed, failures }) });
  }
})();
