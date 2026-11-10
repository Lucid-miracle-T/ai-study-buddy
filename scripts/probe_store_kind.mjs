/* 书城品类/状态改版：真浏览器核对（1280×900 与 390×844）
 * 用法：node scripts/probe_store_kind.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8914/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(url, vw, vh, mobile) {
  const bust = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=${encodeURIComponent(bust)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(nt.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const waiters = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) return 'EXC: ' + ((ex.exception && (ex.exception.description || ex.exception.value)) || '');
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: bust });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break; }
  await sleep(1500);
  return {
    ev, send, close: () => ws.close(),
    shot: async name => {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(os.tmpdir(), name);
      fs.writeFileSync(f, Buffer.from(r.result.data, 'base64'));
      return f;
    }
  };
}

for (const cfg of [{ vw: 1280, vh: 900, mobile: false, tag: 'desk' },
                   { vw: 390, vh: 844, mobile: true, tag: 'm390' }]) {
  const P = await open(URL, cfg.vw, cfg.vh, cfg.mobile);
  await P.ev("goView('store')");
  await sleep(700);
  const r = await P.ev(`(function(){
    var bar=document.getElementById('stkbar');
    var box=document.getElementById('stlist');
    var out={vw:innerWidth,
      chips:Array.prototype.map.call(bar.querySelectorAll('.stkc'),function(c){return c.textContent}),
      chipH:bar.getBoundingClientRect().height,
      barScrollW:bar.scrollWidth, barClientW:bar.clientWidth,
      cards:box.querySelectorAll('.stcard').length,
      soon:box.querySelectorAll('.stcard.soon').length,
      kinds:Array.prototype.map.call(box.querySelectorAll('.sttags .sk'),function(x){return x.textContent}),
      states:Array.prototype.map.call(box.querySelectorAll('.ststate'),function(x){return x.textContent}),
      docScrollW:document.documentElement.scrollWidth,
      overflow:[]
    };
    /* 有没有元素伸出版心 */
    var w=document.documentElement.clientWidth;
    Array.prototype.forEach.call(document.querySelectorAll('#v-store *'),function(e){
      var b=e.getBoundingClientRect();
      if(b.right>w+1&&b.width>0)out.overflow.push(e.tagName.toLowerCase()+'.'+String(e.className||'').slice(0,20)+' right='+Math.round(b.right));
    });
    out.overflow=out.overflow.slice(0,5);
    return out;
  })()`);
  const f = await P.shot('gx-store-' + cfg.tag + '.png');
  console.log('=== ' + cfg.tag + ' ' + cfg.vw + '×' + cfg.vh + ' ===');
  console.log(JSON.stringify(r, null, 1));
  console.log('截图：' + f);
  /* 点一个品类，看筛选是否真的只剩这一类 */
  const f2 = await P.ev(`(function(){
    var c=Array.prototype.filter.call(document.querySelectorAll('#stkbar .stkc'),function(x){return /考前突击/.test(x.textContent)})[0];
    c.click();
    var n=document.querySelectorAll('#stlist .stcard').length;
    var back=document.querySelectorAll('#stkbar .stkc')[0];back.click();
    return n;
  })()`);
  console.log('筛「考前突击」后卡片数：' + f2);
  P.close();
}
