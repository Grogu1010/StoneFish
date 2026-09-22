const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const games = Math.max(2, Number.parseInt(process.env.ARMX_BROWSER_GAMES || '40', 10));
const maxRatio = Number.parseFloat(process.env.ARMX_BROWSER_MAX_TIME_RATIO || '1.4');
const port = 18765 + (process.pid % 1000);
const debugPort = port + 1000;

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    'google-chrome-stable',
    'google-chrome',
    'chromium',
    'chromium-browser'
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes('/') && fs.existsSync(candidate)) return candidate;
    const found = spawnSync('bash', ['-lc', 'command -v ' + candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error('Chrome/Chromium executable not found');
}

async function pollJson(url, attempts = 300) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Timed out waiting for Chrome DevTools');
}

function cdpSocket(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  const opened = new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('Chrome DevTools websocket failed'));
  });
  return {
    async call(method, params = {}) {
      await opened;
      const id = nextId++;
      const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return promise;
    },
    close() { socket.close(); }
  };
}

(async () => {
  const chrome = findChrome();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stonefish-chrome-'));
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
    cwd: __dirname,
    stdio: ['ignore', 'ignore', 'inherit']
  });
  const browser = spawn(chrome, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + userDataDir,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'inherit'] });

  try {
    await pollJson('http://127.0.0.1:' + debugPort + '/json/version');
    const pageUrl = 'http://127.0.0.1:' + port + '/benchmark_armx_browser.html?games=' + games;
    const target = await pollJson('http://127.0.0.1:' + debugPort + '/json/new?' + encodeURIComponent(pageUrl), 1)
      .catch(async () => {
        const response = await fetch('http://127.0.0.1:' + debugPort + '/json/new?' + encodeURIComponent(pageUrl), { method: 'PUT' });
        if (!response.ok) throw new Error('Could not create Chrome benchmark tab: ' + response.status);
        return response.json();
      });
    const cdp = cdpSocket(target.webSocketDebuggerUrl);
    try {
      let ready = false;
      for (let i = 0; i < 200 && !ready; i++) {
        const value = await cdp.call('Runtime.evaluate', {
          expression: 'typeof window.armxBrowserBenchmarkPromise !== "undefined"',
          returnByValue: true
        });
        ready = Boolean(value.result && value.result.value);
        if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!ready) throw new Error('Browser benchmark page did not initialize');

      const evaluated = await cdp.call('Runtime.evaluate', {
        expression: 'window.armxBrowserBenchmarkPromise',
        awaitPromise: true,
        returnByValue: true
      });
      if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text || 'Browser benchmark failed');
      const result = evaluated.result && evaluated.result.value;
      if (!result || !Number.isFinite(result.armxVsControlTimeRatio)) {
        throw new Error('Browser benchmark returned no finite timing ratio');
      }
      console.log('ARMX_BROWSER_VS_NOARMX ' + JSON.stringify(result));
      if (Number.isFinite(maxRatio) && maxRatio > 0 && result.armxVsControlTimeRatio > maxRatio) {
        console.error('ARMX browser timing gate failed: ratio '
          + result.armxVsControlTimeRatio.toFixed(4) + ' > ' + maxRatio.toFixed(4));
        process.exitCode = 3;
      }
    } finally {
      cdp.close();
    }
  } finally {
    browser.kill('SIGTERM');
    server.kill('SIGTERM');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 2;
});
