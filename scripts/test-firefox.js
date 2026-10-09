'use strict';
const { createServer } = require('node:http');
const { mkdtempSync, mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname } = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

(async () => {
  if (!process.env.FIREFOX_BINARY) throw new Error('Set FIREFOX_BINARY to a Firefox 142+ executable.');
  const directory = mkdtempSync(join(tmpdir(), 'firefox-vault-test-'));
  const downloads = join(directory, 'downloads');
  mkdirSync(downloads);
  const profile = join(directory, 'profile');
  mkdirSync(profile);
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  writeFileSync(join(profile, 'extension-preferences.json'), JSON.stringify({
    [manifest.browser_specific_settings.gecko.id]: {
      permissions: ['internal:privateBrowsingAllowed'], origins: []
    }
  }));
  const server = createServer((request, response) => {
    if (request.url === '/report' && request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        response.end('ok');
        const result = JSON.parse(body);
        mkdirSync('test-results', { recursive: true });
        writeFileSync('test-results/firefox.json', JSON.stringify(result, null, 2));
        const version = String(result.browser?.version || 'unknown').replace(/[^0-9a-z.-]/gi, '');
        writeFileSync(`test-results/firefox-${version}.json`, JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
        finish(result.failures.length ? 1 : 0);
      });
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>Tab Vault test fixture</title><p>Local test page</p>');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  manifest.host_permissions = [`${base}/*`];
  manifest.background.scripts.unshift('test-config.js');
  manifest.background.scripts.push('crypto.js');
  manifest.background.scripts.push('test-driver.js');
  for (const file of ['core.js', 'crypto.js', 'firefox.js', 'background.js', 'popup.js', 'popup.css', 'popup.html']) {
    copyFileSync(file, join(directory, file));
  }
  cpSync('icons', join(directory, 'icons'), { recursive: true });
  cpSync('tests/fixtures', join(directory, 'fixtures'), { recursive: true });
  copyFileSync('tests/firefox-driver.js', join(directory, 'test-driver.js'));
  copyFileSync('tests/firefox-ui.js', join(directory, 'test-ui.js'));
  copyFileSync('tests/firefox-import-ui.js', join(directory, 'test-import-ui.js'));
  writeFileSync(join(directory, 'popup.html'), readFileSync('popup.html', 'utf8')
    .replace('</body>', '<script src="test-ui.js"></script><script src="test-import-ui.js"></script></body>'));
  writeFileSync(join(directory, 'test-config.js'), `globalThis.TEST_BASE = ${JSON.stringify(base)};\n` +
    `const originalDownload = browser.downloads.download.bind(browser.downloads);\n` +
    `browser.downloads.download = (options) => originalDownload({ ...options, saveAs: false });\n`);
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  let child;
  let finished = false;
  let timer;
  function finish(code) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    server.close();
    if (child && child.exitCode === null) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); }
        catch { child.kill(); }
      } else child.kill();
    }
    // web-ext owns and removes its Firefox profile/process on termination.
    setTimeout(() => {
      if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'firefox-vault-test-')))) {
        throw new Error('Unexpected test staging path.');
      }
      rmSync(directory, { recursive: true, force: true }); process.exit(code);
    }, 2000);
  }
  const cli = join(dirname(require.resolve('web-ext')), 'bin/web-ext.js');
  child = spawn(process.execPath, [cli, 'run', '--source-dir', directory,
    '--firefox', resolve(process.env.FIREFOX_BINARY), '--firefox-profile', profile,
    '--no-reload', '--no-input', '--args=-headless',
    '--pref=extensions.allowPrivateBrowsingByDefault=true', '--pref=browser.download.useDownloadDir=true',
    '--pref=browser.download.folderList=2', `--pref=browser.download.dir=${downloads}`], { stdio: 'inherit' });
  child.on('error', (error) => { console.error(error); finish(1); });
  child.on('exit', (code) => { if (!finished) finish(code || 1); });
  timer = setTimeout(() => { console.error('Firefox integration test timed out.'); finish(1); }, 180000);
})().catch((error) => { console.error(error); process.exitCode = 1; });
