/* 检查：手机端右下悬浮胶囊只在课堂页出现；群聊页对话区拿到高度
 * 用法：PROBE_PORT=9236 node scripts/probe_chat_view.mjs
 */
const PORT = process.env.PROBE_PORT || 9236;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8912/index.html';
const fs = await import('fs');
const os = await import('os');
const OUT = os.tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(url, vw, vh, mobile) {
  const bust = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=${encodeURIComponent(bust)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(nt.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const waiters = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) return 'EXC: ' + ((ex.exception && (ex.exception.description || ex.exception.value)) || '');
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async f => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: bust });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break; }
  await sleep(1800);
  return { ev, shot, errs, close: () => ws.close() };
}

const P = await open(URL, 390, 844, true);
for (const v of ['lesson', 'chat', 'book', 'store', 'cards', 'prog', 'set']) {
  await P.ev(`goView('${v}')`);
  await sleep(450);
  const r = await P.ev(`(function(){
    var f=document.getElementById('mfab'), cs=getComputedStyle(f);
    var log=document.getElementById('chatlog');
    return {view:document.body.dataset.view, mfab:cs.display,
      logH:log?Math.round(log.getBoundingClientRect().height):null,
      memH:(function(){var m=document.querySelector('.chatmem');
        return m?Math.round(m.getBoundingClientRect().height):null})(),
      docOverflow:document.documentElement.scrollWidth>window.innerWidth+1};
  })()`);
  console.log('  ' + v.padEnd(8) + ' → ' + JSON.stringify(r));
}
/* 课堂页再截一张：胶囊必须还在，且不压在输入框上 */
await P.ev("goView('lesson')");
await sleep(500);
await P.shot(OUT + '/gx-chat-lesson.png');
console.log('截图 → ' + OUT + '/gx-chat-lesson.png');
console.log('JS 异常：' + (P.errs.length ? P.errs.slice(0, 2).join(' | ') : '无'));
P.close();
