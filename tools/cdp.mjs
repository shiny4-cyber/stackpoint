// Minimal CDP driver: open a page, collect console/runtime errors, click, screenshot.
// Usage: node tools/cdp.mjs <url> <out.png> [--click #play] [--wait ms] [--eval "expr"]
const [url, out, ...rest] = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : dflt;
};
const waitMs = Number(opt('--wait', 4000));
const clickSel = opt('--click', null);
const evalExpr = opt('--eval', null);
const PORT = opt('--port', '9224');

const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errors = [];
const logs = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(d.exception?.description || d.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push(msg.params.entry.text);
  }
});

const send = (method, params = {}) => new Promise((res) => {
  const mid = ++id;
  pending.set(mid, res);
  ws.send(JSON.stringify({ id: mid, method, params }));
});

await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, waitMs));

if (clickSel) {
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(clickSel)}); if (!el) return 'missing'; el.click(); return 'clicked'; })()`,
    returnByValue: true,
  });
  console.log('click:', r.result?.result?.value);
  await new Promise((r2) => setTimeout(r2, 2500));
}

if (evalExpr) {
  const r = await send('Runtime.evaluate', { expression: evalExpr, returnByValue: true, awaitPromise: true });
  console.log('eval:', JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? null));
}

const probe = await send('Runtime.evaluate', {
  expression: `(() => {
    const c = document.querySelector('canvas');
    const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
    return {
      canvas: !!c, w: c?.width, h: c?.height,
      gl: !!gl,
      renderer: gl ? gl.getParameter(gl.VERSION) : null,
      hp: document.getElementById('hp')?.textContent,
      timer: document.getElementById('timer')?.textContent,
      fpsHint: window.__frames ?? null
    };
  })()`,
  returnByValue: true,
});
console.log('probe:', JSON.stringify(probe.result?.result?.value));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  const fs = await import('node:fs');
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot:', out);
} else {
  console.log('screenshot failed', JSON.stringify(shot).slice(0, 300));
}

console.log('errors:', JSON.stringify(errors.slice(0, 12), null, 1));
console.log('logs:', JSON.stringify(logs.slice(-12), null, 1));
await send('Page.close').catch(() => {});
ws.close();
process.exit(0);
