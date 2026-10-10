/* Runs in the persistent import tab; excluded from release packages. */
'use strict';
(async () => {
  const mode = new URLSearchParams(location.search).get('test-import');
  if (!mode) return;
  const target = new URLSearchParams(location.search).get('test-import-target');
  const passed = [];
  const failures = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (check) => {
    for (let n = 0; n < 300; n += 1) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Import condition timed out: ${elements.status.textContent}`);
  };
  const run = async (name, fn) => {
    try { await fn(); passed.push(`${mode}, ${target}: ${name}`); }
    catch (error) { failures.push({ name: `${mode}, ${target}: ${name}`, error: error.message, stack: error.stack }); }
  };
  await wait(() => !elements.chooseFile.disabled);
  await run('persistent file picker and destination', async () => {
    assert(isImportPage && document.getElementById('exportSection').hidden, 'Import view missing');
    assert(!document.getElementById('importDestination').hidden, 'Import tab hides the restore destination');
    assert(elements.importTarget.value === 'new', 'New-window default changed');
    elements.importTarget.value = target;
    elements.importTarget.dispatchEvent(new Event('change'));
    assert(contextIsIncognito === (mode === 'private'), 'Browsing mode changed');
    let clicked = false;
    const originalClick = elements.fileInput.click;
    elements.fileInput.click = () => { clicked = true; };
    try { elements.chooseFile.click(); }
    finally { elements.fileInput.click = originalClick; }
    assert(clicked, 'Import tab did not open its own file picker');
  });
  for (const format of ['json', 'txt']) {
    for (const encrypted of [false, true]) {
      for (const origin of ['upstream', 'Firefox']) {
        await run(`${encrypted ? 'encrypted' : 'plain'} ${origin} ${format.toUpperCase()} review and restore`, async () => {
          const originalTabs = await browser.tabs.query({ windowId: sourceWindowId });
          const beforeTabs = new Set(originalTabs.map((tab) => tab.id));
          const beforeWindows = new Set((await browser.windows.getAll()).map((item) => item.id));
          const filename = `${origin.toLowerCase()}${encrypted ? '-encrypted' : ''}.${format}`;
          try {
            let text;
            if (origin === 'upstream') {
              const fixture = `chrome${encrypted ? '-encrypted' : ''}.${format}`;
              text = await (await fetch(browser.runtime.getURL(`fixtures/${fixture}`))).text();
            } else {
              const original = await (await fetch(browser.runtime.getURL('fixtures/chrome.json'))).json();
              const archive = normalizeArchive(original);
              archive.source.browser = 'Firefox';
              archive.windows[0].groups.g1.title = 'Firefox research';
              text = format === 'json' ? JSON.stringify(archive) : archiveToTxt(archive);
              assert(archive.format === 'firefox-tab-vault', 'Export format is not Firefox');
              if (encrypted) {
                const envelope = await encryptBackupContent(text, 'tab-vault-fixture-password', format);
                assert(envelope.format === 'firefox-tab-vault-encrypted', 'Encrypted export format is not Firefox');
                text = serializeEncryptedEnvelope(envelope, format);
              }
              assert(!text.includes('Chrome') && !text.includes('chrome-tab-vault'), 'Export contains legacy branding');
            }
            const transfer = new DataTransfer();
            transfer.items.add(new File([text], filename));
            elements.fileInput.files = transfer.files;
            elements.fileInput.dispatchEvent(new Event('change'));
            if (encrypted) {
              await wait(() => elements.passwordDialog.open);
              elements.passwordInput.value = 'tab-vault-fixture-password';
              elements.passwordSubmit.click();
            }
            await wait(() => elements.reviewDialog.open);
            assert(elements.reviewList.querySelectorAll('.review-tab').length === 4, 'Review did not show four tabs');
            assert(elements.reviewWarning.hidden === (mode === 'private'), 'Private-source warning changed');
            assert((await browser.tabs.query({ windowId: sourceWindowId })).length === originalTabs.length,
              'Tabs opened before confirmation');
            elements.reviewSubmit.click();
            await wait(() => !elements.chooseFile.disabled);
            assert(elements.status.textContent.startsWith('Restored 4 tabs, 1 group.'), elements.status.textContent);
            const windows = await browser.windows.getAll({ populate: true });
            if (target === 'current') {
              const currentTabs = await browser.tabs.query({ windowId: sourceWindowId });
              assert(currentTabs.length === originalTabs.length + 4, 'Append lost or failed to create tabs');
              assert(originalTabs.every((tab) => currentTabs.some((item) => item.id === tab.id)), 'Existing tabs were removed');
              assert(windows.every((item) => beforeWindows.has(item.id)), 'Append created a window');
            } else {
              const restored = windows.filter((item) => !beforeWindows.has(item.id));
              assert(restored.length === 2, 'Separate archived windows were not restored');
              assert(restored.reduce((sum, item) => sum + item.tabs.length, 0) === 4, 'New-window tabs are missing');
              assert(restored.every((item) => item.incognito === (mode === 'private')), 'Restore changed browsing mode');
              assert((await browser.tabs.query({ windowId: sourceWindowId })).length === originalTabs.length,
                'New-window restore changed source tabs');
            }
          } finally {
            if (elements.passwordDialog.open) elements.passwordCancel.click();
            if (elements.reviewDialog.open) elements.reviewCancel.click();
            await wait(() => !elements.chooseFile.disabled);
            for (const item of await browser.windows.getAll()) {
              if (!beforeWindows.has(item.id)) await browser.windows.remove(item.id);
            }
            for (const tab of await browser.tabs.query({ windowId: sourceWindowId })) {
              if (!beforeTabs.has(tab.id)) await browser.tabs.remove(tab.id);
            }
          }
        });
      }
    }
  }
  await browser.runtime.sendMessage({ channel: 'test-import', mode, target, passed, failures });
})().catch(async (error) => {
  const options = new URLSearchParams(location.search);
  await browser.runtime.sendMessage({ channel: 'test-import', mode: options.get('test-import'),
    target: options.get('test-import-target'), passed: [], failures: [{ name: 'Import tab setup', error: error.message }] });
});
