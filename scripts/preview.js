'use strict';
// Layout preview only. Browser API behavior is tested by test:firefox in real Firefox.
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const archive = JSON.parse(readFileSync('tests/fixtures/chrome.json', 'utf8'));
archive.source.incognito = false;
archive.source.browser = 'Firefox';
archive.windows[0].groups.g1.title = 'Firefox research';
const files = new Set(['popup.html', 'popup.css', 'popup.js', 'core.js', 'crypto.js']);
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'popup.html';
  if (name === 'preview-api.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`window.browser = {
      windows: { getCurrent: async () => ({id: 1, incognito: false}) },
      runtime: { sendMessage: async (message) => {
        if (message.type === 'open-import') {
          window.open('popup.html?view=import&target=' + message.target, '_blank');
          return {value: {tabId: 1}};
        }
        return {value:
        message.type === 'result' ? {pending: false, result: null} :
        message.type === 'collect' ? ${JSON.stringify(archive)} :
        message.type === 'restore' ? {created: 4, groups: 1, failed: 0, warnings: 0} : 1
        };
      } }
    };`);
  } else if (files.has(name)) {
    let content = readFileSync(name, 'utf8');
    if (name === 'popup.html') content = content.replace('<script src="core.js">', '<script src="preview-api.js"></script><script src="core.js">');
    response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(content);
  } else { response.writeHead(404); response.end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`Layout preview: http://127.0.0.1:${server.address().port}`));
