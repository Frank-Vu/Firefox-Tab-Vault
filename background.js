'use strict';
const vault = globalThis.TabVaultFirefox.createFirefoxVault(browser);
const results = new Map();
const pendingRestores = new Set();

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || !message || message.channel !== 'tab-vault') return;
  return (async () => {
    try {
      const windowId = message.windowId;
      const source = await vault.context(windowId);
      if (sender.tab && Boolean(sender.tab.incognito) !== source.incognito) {
        throw new Error('The browser mode changed. Reopen the extension in the target window.');
      }
      let value;
      if (message.type === 'collect') value = await vault.collect(message.scope, windowId);
      else if (message.type === 'download') {
        value = await vault.download(message.content, message.filename, message.mimeType, windowId);
      } else if (message.type === 'restore') {
        if (pendingRestores.has(windowId)) throw new Error('A restore is already running in this window.');
        pendingRestores.add(windowId);
        try {
          value = await vault.restore(message.archive, message.target, windowId);
          results.set(windowId, value); // Counts only; never retain URLs or passwords.
        } finally { pendingRestores.delete(windowId); }
      } else if (message.type === 'result') {
        value = { pending: pendingRestores.has(windowId), result: results.get(windowId) || null };
        results.delete(windowId);
      } else throw new Error('Unknown Tab Vault operation.');
      return { value };
    } catch (error) { return { error: error.message }; }
  })();
});
browser.windows.onRemoved.addListener((windowId) => results.delete(windowId));
