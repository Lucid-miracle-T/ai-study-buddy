/* 量群聊页在手机上的高度分配：谁把对话区吃掉了
 * 用法：PROBE_PORT=9236 PROBE_URL=http://127.0.0.1:8912/index.html node scripts/probe_chat_h.mjs
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

const HEIGHTS = `(function(){
  function r(sel){var e=document.querySelector(sel);if(!e)return null;
    var b=e.getBoundingClientRect();return {h:Math.round(b.height),top:Math.round(b.top),bot:Math.round(b.bottom)};}
  return {
    vh:window.innerHeight,
    view:document.body.dataset.view,
    cls:document.body.className,
    app:r('#app'), stage:r('#stage'), vchat:r('#v-chat'), bar:r('#v-chat .bar'),
    sessions:r('#chatsessions'), mem:r('.chatmem'), members:r('#chatmembers'),
    hint:r('#chathint'), log:r('#chatlog'), bar2:r('#chatbar'),
    mtab:r('#mtabbar'), lbar1:r('#lbar1'), lbar2:r('#lbar2'),
    symbar:r('#symbar'), foot:r('#foot'),
    logScrollH:(function(){var e=document.getElementById('chatlog');return e?e.scrollHeight:null})(),
    vchatDisplay:getComputedStyle(document.getElementById('v-chat')).display,
    stageOverflow:getComputedStyle(document.getElementById('stage')).overflow
  };
})()`;

async function run() {
  for (const cfg of [{ vw: 390, vh: 844, mobile: true, tag: 'm390' },
                     { vw: 360, vh: 780, mobile: true, tag: 'm360' }]) {
    console.log('\n========== ' + cfg.tag + ' ==========');
    const P = await open(URL, cfg.vw, cfg.vh, cfg.mobile);
    /* 进入群聊：先上课（保证有会话/成员），再切课余 */
    await P.ev("goView('chat')");
    await sleep(900);
    console.log(JSON.stringify(await P.ev(HEIGHTS), null, 1));
    await P.shot(OUT + '/gx-chat-' + cfg.tag + '.png');
    console.log('截图 → ' + OUT + '/gx-chat-' + cfg.tag + '.png');
    console.log('JS 异常：' + (P.errs.length ? P.errs.slice(0, 2).join(' | ') : '无'));
    P.close();
  }
}
run().catch(e => { console.error('探针失败：', e); process.exit(1) });
