'use strict';
const { execFileSync } = require('node:child_process');
const { mkdirSync, copyFileSync, cpSync, mkdtempSync, rmSync } = require('node:fs');
const { join, dirname, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { version } = require('../manifest.json');
mkdirSync('dist', { recursive: true });
const prefix = join(tmpdir(), 'firefox-tab-vault-build-');
const staging = mkdtempSync(prefix);
try {
  for (const file of ['manifest.json', 'core.js', 'crypto.js', 'firefox.js', 'background.js',
    'popup.html', 'popup.css', 'popup.js']) copyFileSync(file, join(staging, file));
  cpSync('icons', join(staging, 'icons'), { recursive: true });
  execFileSync(process.execPath, [join(dirname(require.resolve('web-ext')), 'bin/web-ext.js'), 'build',
    '--source-dir', staging, '--artifacts-dir', resolve('dist'),
    '--filename', `firefox-tab-vault-${version}.zip`, '--overwrite-dest'], { stdio: 'inherit' });
} finally {
  if (!resolve(staging).startsWith(resolve(prefix))) throw new Error('Unexpected build staging path.');
  rmSync(staging, { recursive: true, force: true });
}
copyFileSync(join('dist', `firefox-tab-vault-${version}.zip`), join('dist', `firefox-tab-vault-${version}.xpi`));
