/* 真浏览器验证「手机抽屉」：jsdom 没有布局引擎，这一步不能省
 *
 * 前置：
 *   python -m http.server 8904 --bind 127.0.0.1
 *   msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
 * 用法：node scripts/probe_drawer.mjs
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
    return {h:Math.round(r.height),y:Math.round(r.y),w:Math.round(r.width),
            disp:cs.display,可见:cs.display!=='none'&&r.width>0};}
  var vh=window.innerHeight, msgs=document.querySelector('#msgs').getBoundingClientRect();
  var chrome=['#ctabs','#stabs','#lbar1','#lbar2'].reduce(function(n,s){
    var e=document.querySelector(s);if(!e)return n;var r=e.getBoundingClientRect();
    return n+(getComputedStyle(e).display!=='none'&&r.height>0&&r.y<msgs.top?r.height:0);
  },0);
  var send=document.querySelector('#send').getBoundingClientRect();
  var visNav=[].slice.call(document.querySelectorAll('#drawer .nv button'))
    .filter(function(b){var r=b.getBoundingClientRect();return r.width>0&&getComputedStyle(b).display!=='none'})
    .map(function(b){return b.textContent.trim()});
  return JSON.stringify({
    视口:window.innerWidth+'x'+vh,
    body类:document.body.className,
    顶栏:box('#topbar'), 侧栏:box('#nav'), 抽屉:box('#drawer'),
    课程栏:box('#ctabs'), 节栏:box('#stabs'), 工具栏1:box('#lbar1'), 工具栏2:box('#lbar2'),
    符号栏:box('#symbar'), 节奏条:box('#pacebar'), 输入区:box('#inbar'),
    对话区高:Math.round(msgs.height), 对话区占比:Math.round(msgs.height/vh*100)+'%',
    主屏chrome高:Math.round(chrome),
    抽屉内可见导航:visNav,
    子栏目:[].slice.call(document.querySelectorAll('#drawer details')).map(function(d){return d.querySelector('summary').textContent.trim()+(d.open?'(展开)':'(收起)')}),
    发送在视口内:send.bottom<=vh+1&&send.top>=0,
    横向溢出:document.documentElement.scrollWidth>window.innerWidth+1,
    纵向溢出:document.body.scrollHeight>vh+1
  },null,1)})()`;

console.log('\n########## 1. 桌面 1280×800：抽屉不生效，原结构不动 ##########');
const D = await open(URL, 1280, 800, false);
await D.ev(`document.querySelector('#lhStart') && document.querySelector('#lhStart').click()`);
await sleep(400);
console.log(await D.ev(LAYOUT));
console.log('  JS 异常：' + (D.errs.length ? D.errs.join(' | ') : '无'));
await D.close();

console.log('\n########## 2. 手机 390×844：对话区占比 ##########');
const M = await open(URL, 390, 844, true);
await M.ev(`document.querySelector('#lhStart') && document.querySelector('#lhStart').click()`);
await sleep(2800);   /* 等开场 toast 淡出，截图别被它盖住 */
console.log(await M.ev(LAYOUT));
await M.shot(path.join(OUT, 'gx_drawer_mobile_class.png'));

console.log('\n########## 3. 点 ☰ 打开抽屉 ##########');
await M.ev(`document.querySelector('#dOpen').click()`);
await sleep(350);
console.log(await M.ev(LAYOUT));
await M.shot(path.join(OUT, 'gx_drawer_open.png'));

console.log('\n########## 4. 抽屉里点「教材」：切页 + 自动收起 ##########');
await M.ev(`[].slice.call(document.querySelectorAll('#drawer .nv button')).filter(function(b){return b.dataset.v==='book'})[0].click()`);
await sleep(350);
console.log(await M.ev(`JSON.stringify({抽屉:document.body.classList.contains('drawer'),教材页:document.querySelector('#v-book').classList.contains('on'),横向溢出:document.documentElement.scrollWidth>window.innerWidth+1},null,1)`));
await M.ev(`[].slice.call(document.querySelectorAll('#drawer .nv button')).filter(function(b){return b.dataset.v==='lesson'})[0].click()`);
await sleep(250);

console.log('\n########## 5. 点 ＋ 打开开课向导 ##########');
await M.ev(`document.querySelector('#dNew').click()`);
await sleep(2800);
console.log(await M.ev(`JSON.stringify({向导:!document.querySelector('#launch').hidden,顶栏可见:getComputedStyle(document.querySelector('#topbar')).display!=='none',抽屉:document.body.classList.contains('drawer')},null,1)`));
await M.shot(path.join(OUT, 'gx_drawer_wizard.png'));
console.log('  JS 异常：' + (M.errs.length ? M.errs.join(' | ') : '无'));
await M.close();
