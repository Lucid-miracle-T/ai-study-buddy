/* 真浏览器验证「破卷式外壳」：布局 / 深色 / 向导 / 手机断点
   jsdom 没有布局引擎，也解析不了媒体查询，所以这一步不能省。

   前置：
     python -m http.server 8904 --bind 127.0.0.1
     msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
   用法：node scripts/probe_shell.mjs
*/
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8904/index.html';
const fs = await import('fs');
const os = await import('os');
const path = await import('path');
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
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) return 'EXC: ' + ((ex.exception && (ex.exception.description || ex.exception.value)) || '');
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async f => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
    console.log('  截图 → ' + f);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: bust });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof LITE!=="undefined"') === true) break; }
  await sleep(1800);
  return { ev, shot, errs, close: () => ws.close() };
}

const LAYOUT = `(function(){
  function box(sel){var e=document.querySelector(sel);if(!e)return null;
    var r=e.getBoundingClientRect();var cs=getComputedStyle(e);
    return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y),
            disp:cs.display,bg:cs.backgroundColor,vis:cs.display!=='none'&&r.width>0};}
  return JSON.stringify({
    主题:document.body.className, 分组:document.body.dataset.navgrp,
    向导:box('#launch'), 向导标题:box('.lh-title h1'), 第一张伙伴卡:box('.lh-card'),
    主按钮:box('.lh-go'), 侧栏:box('#nav'), 图标网格:box('.nv'), 分组标签:box('#gtabs'),
    课堂摘要:box('#lsum'), 课堂工具条:box('#lbar1'), 节奏开关:box('#pctoggle'),
    输入区:box('#inbar'), 发送:box('#send'),
    可见工具条按钮:[].slice.call(document.querySelectorAll('#lbar1 button,#lbar2 button'))
      .filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&getComputedStyle(b).display!=='none'})
      .map(function(b){return b.textContent.trim()}),
    可见导航:[].slice.call(document.querySelectorAll('.nv button'))
      .filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&getComputedStyle(b).display!=='none'})
      .map(function(b){return b.textContent.trim()}),
    滚动溢出:{stage:document.querySelector('#stage').scrollHeight>document.querySelector('#stage').clientHeight,
              body:document.body.scrollHeight>window.innerHeight}
  },null,1)})()`;

console.log('\n########## 1. 桌面 1280×800：开课向导 ##########');
const D = await open(URL, 1280, 800, false);
console.log(await D.ev(LAYOUT));
await D.shot(path.join(OUT, 'gx_shell_wizard.png'));

console.log('\n########## 2. 进课堂：默认一行工具栏 ##########');
await D.ev(`document.querySelector('#lhStart').click()`);
await sleep(400);
console.log(await D.ev(LAYOUT));
await D.shot(path.join(OUT, 'gx_shell_class.png'));

console.log('\n########## 3. 点「⋯」：原工具栏完整展开 ##########');
await D.ev(`document.querySelector('#lexpand').click()`);
await sleep(300);
console.log(await D.ev(LAYOUT));
await D.shot(path.join(OUT, 'gx_shell_expand.png'));
console.log('  JS 异常：' + (D.errs.length ? D.errs.join(' | ') : '无'));
await D.close();

console.log('\n########## 4. 手机 390×844 ##########');
const M = await open(URL, 390, 844, true);
console.log(await M.ev(LAYOUT));
await M.shot(path.join(OUT, 'gx_shell_mobile_wizard.png'));
await M.ev(`document.querySelector('#lhStart').click()`);
await sleep(400);
console.log(await M.ev(LAYOUT));
await M.shot(path.join(OUT, 'gx_shell_mobile_class.png'));
console.log('  JS 异常：' + (M.errs.length ? M.errs.join(' | ') : '无'));
await M.close();
