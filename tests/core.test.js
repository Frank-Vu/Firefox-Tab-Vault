'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeArchive, archiveToTxt, parseTxt } = require('../core.js');

test('JSON and TXT round trips preserve all tab, group and window metadata', () => {
  const archive = normalizeArchive({ source: { incognito: true, browser: 'Firefox', scope: 'all-windows' }, windows: [{
    state: 'maximized', focused: true, left: -120, top: 50, width: 1200, height: 850,
    groups: { g1: { title: 'Research 🦊', color: 'orange', collapsed: true } },
    tabs: [{ url: 'https://example.org/?a=1#fragment', title: 'Example', pinned: false,
      active: true, muted: true, discarded: false, autoDiscardable: false, groupKey: 'g1' },
      { url: 'https://example.org/sleep', pinned: true, discarded: true }]
  }] });
  assert.deepEqual(normalizeArchive(JSON.parse(JSON.stringify(archive))), archive);
  assert.deepEqual(parseTxt(archiveToTxt(archive)), archive);
});

test('ordinary URL lists and legacy JSON tab arrays import without groups', () => {
  const txt = parseTxt('# A comment\nexample.org\n\nhttps://example.com\r\n');
  assert.deepEqual(txt.windows[0].tabs.map((tab) => tab.url), ['https://example.org', 'https://example.com']);
  assert.equal(Object.keys(txt.windows[0].groups).length, 0);
  assert.equal(normalizeArchive(['example.org']).windows[0].tabs[0].url, 'https://example.org');
  assert.equal(normalizeArchive({ tabs: ['example.org'] }).windows.length, 1);
});

test('invalid and empty backups fail before opening tabs', () => {
  for (const input of [null, {}, { windows: [] }, { windows: [{ tabs: [null, '', {}] }] }]) {
    assert.throws(() => normalizeArchive(input));
  }
  assert.throws(() => parseTxt('# @window malformed\nhttps://example.org'), /metadata/);
  assert.throws(() => parseTxt(''), /No restorable/);
});

test('untrusted group names cannot alter object prototypes', () => {
  const archive = normalizeArchive(JSON.parse('{"windows":[{"groups":{"__proto__":{"title":"Safe","color":"red"}},"tabs":[{"url":"https://example.org","groupKey":"__proto__"},{"url":"https://example.com","groupKey":"constructor"}]}]}'));
  assert.equal(archive.windows[0].groups.__proto__.title, 'Safe');
  assert.equal(archive.windows[0].groups.constructor.color, 'grey');
  assert.equal({}.title, undefined);
  const roundTrip = parseTxt(archiveToTxt(archive));
  assert.equal(roundTrip.windows[0].groups.__proto__.title, 'Safe');
});

test('invalid geometry and unsupported colors are normalized', () => {
  const window = normalizeArchive({ windows: [{ left: 1.5, top: -50, width: -1, height: '500', groups: {
    g1: { color: 'invalid' }
  }, tabs: [{ url: 'https://example.org', groupKey: 'g1' }] }] }).windows[0];
  assert.equal(window.top, -50);
  for (const key of ['left', 'width', 'height']) assert.equal(Object.hasOwn(window, key), false);
  assert.equal(window.groups.g1.color, 'grey');
});
