#!/usr/bin/env node
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const requested = process.argv.slice(2);
const fixtureFiles = requested.length
  ? requested.map(item => item.includes(path.sep) ? item : path.join('tests', item))
  : fs.readdirSync(__dirname)
    .filter(name => name.endsWith('-browser-fixture.html'))
    .sort()
    .map(name => path.join('tests', name));
const timeoutMs = Number(process.env.AOC_BROWSER_FIXTURE_TIMEOUT_MS) || 60000;

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'chromium',
    'chromium-browser'
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  throw new Error('Chrome/Chromium was not found. Set CHROME_BIN to run browser fixtures.');
}

function contentType(file) {
  const ext = path.extname(file);
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8'
  }[ext] || 'application/octet-stream';
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(root, relative);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(file, (error, data) => {
        if (error) {
          res.writeHead(error.code === 'ENOENT' ? 404 : 500);
          res.end(error.message);
          return;
        }
        if (path.basename(file) === 'index.html') {
          data = Buffer.from(data.toString()
            .replace('https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css', 'tests/maplibre-gl-stub.css')
            .replace('https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js', 'tests/maplibre-gl-stub.js'));
        }
        res.writeHead(200, { 'Content-Type': contentType(file), 'Cache-Control': 'no-store' });
        res.end(data);
      });
    } catch (error) {
      res.writeHead(500);
      res.end(String(error.stack || error));
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function waitForDevTools(chrome) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Chrome DevTools endpoint.')), 15000);
    const onData = chunk => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    };
    chrome.stderr.on('data', onData);
    chrome.stdout.on('data', onData);
    chrome.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    chrome.once('exit', code => {
      if (!buffer.match(/DevTools listening on/)) {
        clearTimeout(timer);
        reject(new Error(`Chrome exited before DevTools was ready (${code}).`));
      }
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}${message.error.data ? `: ${message.error.data}` : ''}`));
      else resolve(message.result || {});
    });
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    this.ws.close();
  }
}

async function runFixture(client, url, name) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const started = Date.now();
  try {
    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Page.navigate', { url }, sessionId);
    let lastText = '';
    while (Date.now() - started < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const evaluation = await client.send('Runtime.evaluate', {
        expression: "document.querySelector('#result')?.textContent || ''",
        returnByValue: true
      }, sessionId);
      lastText = evaluation.result?.value || '';
      if (/^(PASS|FAIL)\b/.test(lastText.trim())) break;
    }
    if (!/^(PASS|FAIL)\b/.test(lastText.trim())) {
      throw new Error(`${name} timed out after ${timeoutMs}ms. Last result text: ${lastText || '(empty)'}`);
    }
    if (lastText.trim().startsWith('FAIL')) throw new Error(lastText.trim());
    return lastText.trim();
  } finally {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

(async () => {
  let server;
  let chrome;
  let client;
  const results = [];
  try {
    server = await startStaticServer();
    const port = server.address().port;
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aoc-browser-fixtures-'));
    chrome = spawn(findChrome(), [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    client = new CdpClient(await waitForDevTools(chrome));
    await client.open();
    for (const fixture of fixtureFiles) {
      const relative = fixture.replaceAll(path.sep, '/');
      const url = `http://127.0.0.1:${port}/${relative}?runner=${Date.now()}`;
      try {
        const message = await runFixture(client, url, relative);
        results.push({ fixture: relative, ok: true, message });
        console.log(`PASS ${relative}`);
      } catch (error) {
        const message = String(error.stack || error);
        results.push({ fixture: relative, ok: false, message });
        console.error(`FAIL ${relative}\n${message}`);
      }
    }
    const failures = results.filter(item => !item.ok);
    if (failures.length) {
      console.error(`\n${failures.length}/${results.length} browser fixture(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log(`\n${results.length} browser fixture(s) passed.`);
    }
  } catch (error) {
    results.push({ ok: false, message: String(error.stack || error) });
    console.error(String(error.stack || error));
    process.exitCode = 1;
  } finally {
    if (client) client.close();
    if (chrome && !chrome.killed) chrome.kill();
    if (server) server.close();
  }
})();
