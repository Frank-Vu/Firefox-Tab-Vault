/* Runs in a real extension page; excluded from release packages. */
'use strict';
(async () => {
  const mode = new URLSearchParams(location.search).get('test');
  if (!mode) return;
  const config = await browser.runtime.sendMessage({ channel: 'test-ui', type: 'config', mode });
  const passed = [];
  const failures = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (check, attempts = 300) => {
    for (let n = 0; n < attempts; n += 1) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error('UI condition timed out');
  };
  const run = async (name, fn) => {
    try { await fn(); passed.push(`${mode}: ${name}`); }
    catch (error) { failures.push({ name: `${mode}: ${name}`, error: error.message, stack: error.stack }); }
  };
  const loadFile = async (filename, text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], filename));
    elements.fileInput.files = transfer.files;
    elements.fileInput.dispatchEvent(new Event('change'));
  };
  await wait(() => !elements.exportJson.disabled);
  await run('correct context and encryption default', async () => {
    assert(elements.encryptExport.checked === (mode === 'private'), 'Wrong encryption default');
    assert(elements.contextBadge.textContent.startsWith(mode === 'private' ? 'Private' : 'Normal'), 'Wrong mode badge');
  });
  await run('export review, per-tab selection, select all and cancellation', async () => {
    elements.exportScope.value = 'all';
    elements.exportTxt.click();
    await wait(() => elements.reviewDialog.open);
    const text = elements.reviewList.textContent;
    assert(!text.includes(mode === 'private' ? '/normal' : '/private'), 'Review includes opposite-mode tabs');
    elements.reviewSelectAll.click();
    assert(elements.reviewSubmit.disabled, 'Zero-selection export remained enabled');
    reviewTabCheckboxes()[0].click();
    assert(elements.reviewSelectAll.indeterminate, 'Partial selection is not shown');
    assert(!elements.reviewSubmit.disabled, 'Single-tab export is disabled');
    elements.reviewCancel.click();
    await wait(() => !elements.exportTxt.disabled);
    assert(elements.status.textContent.includes('cancelled'), 'Cancellation status missing');
  });
  await run('password validation and encrypted JSON download', async () => {
    elements.encryptExport.checked = true;
    elements.exportJson.click();
    await wait(() => elements.reviewDialog.open);
    elements.reviewSubmit.click();
    await wait(() => elements.passwordDialog.open);
    elements.passwordInput.value = 'short';
    elements.passwordConfirm.value = 'short';
    elements.passwordSubmit.click();
    assert(elements.passwordError.textContent.includes('8'), 'Short password accepted');
    elements.passwordInput.value = 'test-password';
    elements.passwordConfirm.value = 'different';
    elements.passwordSubmit.click();
    assert(elements.passwordError.textContent.includes('match'), 'Mismatched passwords accepted');
    elements.passwordConfirm.value = 'test-password';
    elements.passwordSubmit.click();
    await wait(() => !elements.exportJson.disabled);
    assert(elements.status.textContent.includes('Exported and encrypted'), elements.status.textContent);
    const items = await browser.downloads.search({ query: ['firefox-tabs'], orderBy: ['-startTime'] });
    const download = items.find((item) => item.incognito === (mode === 'private'));
    assert(download, 'Download was associated with the wrong browser mode');
  });
  await run('plain TXT import review and cancellation open no tabs', async () => {
    const before = (await browser.tabs.query({ windowId: sourceWindowId })).length;
    elements.importTarget.value = 'current';
    await loadFile('urls.txt', `${config.base}/plain-one\n${config.base}/plain-two\n`);
    await wait(() => elements.reviewDialog.open);
    assert(elements.reviewList.querySelectorAll('.review-tab').length === 2, 'Plain TXT list not parsed');
    elements.reviewCancel.click();
    await wait(() => !elements.chooseFile.disabled);
    assert((await browser.tabs.query({ windowId: sourceWindowId })).length === before, 'Cancelled import opened tabs');
  });
  await run('wrong encrypted-backup password opens no tabs', async () => {
    const before = (await browser.tabs.query({ windowId: sourceWindowId })).length;
    const text = await (await fetch(browser.runtime.getURL('fixtures/chrome-encrypted.json'))).text();
    await loadFile('chrome-encrypted.json', text);
    await wait(() => elements.passwordDialog.open);
    elements.passwordInput.value = 'wrong-password';
    elements.passwordSubmit.click();
    await wait(() => !elements.chooseFile.disabled);
    assert(elements.status.textContent.includes('password is incorrect'), 'Wrong-password error missing');
    assert((await browser.tabs.query({ windowId: sourceWindowId })).length === before, 'Failed decryption opened tabs');
  });
  await run('encrypted upstream import, private warning, and append', async () => {
    const before = (await browser.tabs.query({ windowId: sourceWindowId })).length;
    const text = await (await fetch(browser.runtime.getURL('fixtures/chrome-encrypted.txt'))).text();
    await loadFile('chrome-encrypted.txt', text);
    await wait(() => elements.passwordDialog.open);
    elements.passwordInput.value = 'tab-vault-fixture-password';
    elements.passwordSubmit.click();
    await wait(() => elements.reviewDialog.open);
    assert(elements.reviewWarning.hidden === (mode === 'private'), 'Private-source warning is incorrect');
    elements.reviewSubmit.click();
    await wait(() => !elements.chooseFile.disabled);
    assert(elements.status.textContent.startsWith('Restored 4 tabs, 1 group.'), elements.status.textContent);
    assert((await browser.tabs.query({ windowId: sourceWindowId })).length === before + 4, 'Append changed existing tabs');
  });
  await run('unencrypted selective TXT export retains metadata', async () => {
    elements.encryptExport.checked = false;
    elements.exportTxt.click();
    await wait(() => elements.reviewDialog.open);
    elements.reviewSelectAll.click();
    reviewTabCheckboxes()[0].click();
    elements.reviewSubmit.click();
    await wait(() => !elements.exportTxt.disabled);
    assert(elements.status.textContent.startsWith('Exported 1 tab from 1 window.'), elements.status.textContent);
  });
  for (const target of ['current', 'new']) {
    await run(`${target}: popup hands import to a persistent tab`, async () => {
      elements.importTarget.value = target;
      const before = new Set((await browser.tabs.query({ windowId: sourceWindowId })).map((tab) => tab.id));
      let pickerOpened = false;
      const originalClick = elements.fileInput.click;
      elements.fileInput.click = () => { pickerOpened = true; };
      let importTab;
      try {
        elements.chooseFile.click();
        await wait(async () => {
          importTab = (await browser.tabs.query({ windowId: sourceWindowId })).find((tab) =>
            !before.has(tab.id) && tab.url?.includes('view=import'));
          return importTab;
        });
        assert(!pickerOpened, 'File picker opened in the toolbar popup');
        assert(importTab.incognito === (mode === 'private'), 'Import tab changed browsing mode');
        assert(new URL(importTab.url).searchParams.get('target') === target, 'Destination was lost');
        let done;
        const completed = new Promise((resolve) => { done = resolve; });
        const listener = (message) => {
          if (message?.channel === 'test-import' && message.mode === mode && message.target === target) {
            done(message);
            return Promise.resolve({});
          }
        };
        browser.runtime.onMessage.addListener(listener);
        try {
          await browser.tabs.update(importTab.id, { url: `${importTab.url}&test-import=${mode}` });
          let report;
          void completed.then((value) => { report = value; });
          await wait(() => report, 1000);
          passed.push(...report.passed);
          failures.push(...report.failures);
        } finally {
          browser.runtime.onMessage.removeListener(listener);
        }
      } finally {
        elements.fileInput.click = originalClick;
        if (importTab) await browser.tabs.remove(importTab.id);
      }
    });
  }
  await browser.runtime.sendMessage({ channel: 'test-ui', type: 'closing', mode });
  void callBackground({ type: 'restore', target: 'new', archive: {
    windows: [{ tabs: Array.from({ length: 15 }, (_, index) => ({
      url: `${config.base}/${mode}-background-${index}`, discarded: index > 0, active: index === 0
    })) }]
  } });
  const current = await browser.tabs.getCurrent();
  await browser.runtime.sendMessage({ channel: 'test-ui', type: 'done', mode, passed, failures });
  await browser.tabs.remove(current.id);
})().catch(async (error) => {
  const mode = new URLSearchParams(location.search).get('test');
  await browser.runtime.sendMessage({ channel: 'test-ui', type: 'done', mode, passed: [],
    failures: [{ name: `${mode}: UI setup`, error: error.message, stack: error.stack }] });
});
