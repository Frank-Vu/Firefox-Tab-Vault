'use strict';
// Run with a checkout of the pinned Chrome source; fixtures contain only example URLs.
const { resolve } = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const source = resolve(process.argv[2]);
const core = require(resolve(source, 'core.js'));
const crypto = require(resolve(source, 'crypto.js'));
const password = 'tab-vault-fixture-password';
const archive = { format: core.FORMAT, version: core.VERSION, exportedAt: '2026-10-09T00:00:00.000Z',
  source: { incognito: true, scope: 'all-windows' }, windows: [{ state: 'normal', focused: true,
    groups: { g1: { title: 'Chrome research', color: 'blue', collapsed: true } }, tabs: [
      { url: 'https://example.org/pinned', pinned: true },
      { url: 'https://example.org/active', active: true, muted: true, groupKey: 'g1' },
      { url: 'https://example.org/sleep', discarded: true, groupKey: 'g1' }
    ] }, { state: 'maximized', focused: false, tabs: [{ url: 'https://example.com/other' }], groups: {} }] };
(async () => {
  mkdirSync('tests/fixtures', { recursive: true });
  for (const format of ['json', 'txt']) {
    const content = format === 'json' ? JSON.stringify(archive, null, 2) : core.archiveToTxt(archive);
    writeFileSync(`tests/fixtures/chrome.${format}`, content);
    const encrypted = await crypto.encryptBackupContent(content, password, format);
    writeFileSync(`tests/fixtures/chrome-encrypted.${format}`, crypto.serializeEncryptedEnvelope(encrypted, format));
  }
})();
