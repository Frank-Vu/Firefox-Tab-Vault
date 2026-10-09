'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const core = require('../core.js');
const crypto = require('../crypto.js');
const read = (name) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
for (const format of ['json', 'txt']) {
  test(`imports an actual upstream Chrome ${format.toUpperCase()} fixture`, () => {
    const content = read(`chrome.${format}`);
    const archive = format === 'json' ? core.normalizeArchive(JSON.parse(content)) : core.parseTxt(content);
    assert.equal(archive.windows.length, 2);
    assert.equal(archive.windows[0].tabs[0].pinned, true);
    assert.equal(archive.windows[0].groups.g1.title, 'Chrome research');
    assert.equal(archive.source.incognito, true);
  });
  test(`decrypts upstream Chrome encrypted ${format.toUpperCase()} with its original password`, async () => {
    const envelope = crypto.parseEncryptedEnvelope(read(`chrome-encrypted.${format}`));
    const decrypted = await crypto.decryptBackupContent(envelope, 'tab-vault-fixture-password');
    assert.equal(decrypted.plaintext, read(`chrome.${format}`));
    assert.equal(decrypted.payloadFormat, format);
  });
}
