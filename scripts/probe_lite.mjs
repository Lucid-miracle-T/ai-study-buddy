/* 真浏览器验证「GitHub Pages 体验版」
   为什么必须真浏览器：要确认的是「按域名切换后，界面上到底少了什么、有没有挤坏」——
   jsdom 没有布局引擎，量不出按钮的可视性和导航条宽度。

   前置：
     python -m http.server 8902 --bind 127.0.0.1
     msedge --headless=new --remote-debugging-port=9231 --remote-allow-origins=* \
            --host-resolver-rules="MAP lite.github.io 127.0.0.1"
   （关键就是那条 host-resolver-rules：让 lite.github.io 解析到本机，
     这样 location.hostname 真的是 github.io，LITE 才会被判为真。）

   用法：node scripts/probe_lite.mjs */
const PORT = process.env.PROBE_PORT || 9231;
const LITE_URL = process.env.PROBE_LITE || 'http://lite.github.io:8902/index.html';
const FULL_URL = process.env.PROBE_FULL || 'http://127.0.0.1:8902/index.html';

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
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push((d.exception && (d.exception.description || d.exception.value)) || d.text) }
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) return 'EXC: ' + ((ex.exception && (ex.exception.description || ex.exception.value)) || '');
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async f => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(f, Buffer.from(s.result.data, 'base64')); console.log('  截图 → ' + f) };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: bust });
  /* Page.reload/navigate 之后立刻 evaluate 会撞上上下文切换，必须轮询等脚本就位 */
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof LITE!=="undefined"') === true) break }
  await sleep(3500);   /* 等内置教材自动载入（体验版一本 / 完整版三本） */
  return { ev, shot, errs, close: () => ws.close() };
}

/* 一次把「界面上到底有什么」全量出来 */
const DUMP = `(function(){
  function vis(sel){var e=document.querySelector(sel);if(!e)return 'missing';
    var r=e.getBoundingClientRect();var cs=getComputedStyle(e);
    return (cs.display==='none'||(r.width===0&&r.height===0))?'隐藏':'显示'}
  var navs=[].slice.call(document.querySelectorAll('#nav .nv button')).map(function(b){
    var v=b.getAttribute('data-v');return b.textContent.trim()+(v?('['+vis('[data-v="'+v+'"]')+']'):'')});
  var ctEl=document.querySelector('#ctabs');
  var ctabs=ctEl?[].slice.call(ctEl.children).map(function(t){return t.textContent.trim()}):['(#ctabs 不存在)'];
  return JSON.stringify({
    域名:location.hostname, LITE:LITE,
    教材包:PACKS.map(function(p){return p.name}),
    导师:pKeys(),
    内置网课:VBUILTIN.length,
    导航:navs,
    导师气泡:document.querySelectorAll('#pbox .pill').length,
    载入按钮文案:(document.querySelector('#reload')||{}).textContent,
    导入网课包:vis('#vimp'),
    课程标签:ctabs, 分册数:(typeof CH!=='undefined'?CH.length:-1),
    导航条宽:Math.round((document.querySelector('#nav')||{getBoundingClientRect:function(){return{width:0}}}).getBoundingClientRect().width)
  },null,1)})()`;

/* 教材页那几个按钮：必须在「教材」视图激活时量 —— 否则整页 display:none，
   每个按钮都是 0 尺寸，分不清是「被藏了」还是「页面没显示」。 */
const BOOKPROBE = `(function(){
  function info(sel){var e=document.querySelector(sel);if(!e)return 'missing';
    var r=e.getBoundingClientRect();var cs=getComputedStyle(e);
    return {内联:e.style.display||'(空)', 计算:cs.display, 宽:Math.round(r.width), 可见:(cs.display!=='none'&&r.width>0)}}
  return JSON.stringify({书页:document.querySelector('#v-book').className,
    仅高数:info('#ldg'), 仅线代:info('#ldl'), 仅C:info('#ldc'),
    载入:info('#reload'), 导入教材:info('#pickfile'), 导入网课包:info('#vimp')},null,1)})()`;

console.log('\n########## 1. 体验版（location.hostname = lite.github.io）##########');
const L = await open(LITE_URL, 1280, 900, false);
/* 复用 user-data-dir 会把上次停留的视图带回来，这里显式切回「上课」页再截 */
await L.ev(`document.querySelector('[data-v="lesson"]').click()`);
await sleep(600);
console.log(await L.ev(DUMP));
await L.shot(path.join(OUT, 'lite_desktop.png'));
await L.ev(`document.querySelector('[data-v="book"]').click()`);
await sleep(600);
console.log('  教材页按钮（视图已激活）：');
console.log(await L.ev(BOOKPROBE));
await L.shot(path.join(OUT, 'lite_book.png'));
console.log('  JS 异常：' + (L.errs.length ? L.errs.join(' | ') : '无'));
await L.close();

console.log('\n########## 2. 完整版（location.hostname = 127.0.0.1）##########');
const F = await open(FULL_URL, 1280, 900, false);
console.log(await F.ev(DUMP));
await F.shot(path.join(OUT, 'full_desktop.png'));
await F.ev(`document.querySelector('[data-v="book"]').click()`);
await sleep(600);
console.log('  教材页按钮（视图已激活）：');
console.log(await F.ev(BOOKPROBE));
await F.shot(path.join(OUT, 'full_book.png'));
console.log('  JS 异常：' + (F.errs.length ? F.errs.join(' | ') : '无'));
await F.close();

console.log('\n########## 3. 体验版手机（390 宽）##########');
const M = await open(LITE_URL, 390, 780, true);
console.log('  ' + await M.ev(`(function(){
  var nav=document.querySelector('#nav'),nv=document.querySelector('#nav .nv');
  return JSON.stringify({导航宽:Math.round(nav.getBoundingClientRect().width),
    按钮组宽:Math.round(nv.getBoundingClientRect().width),
    横向溢出:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    网课入口:(function(){var e=document.querySelector('[data-v="vid"]');
      return getComputedStyle(e).display==='none'?'已收起':'还在'})()})})()`));
await M.shot(path.join(OUT, 'lite_mobile.png'));
console.log('  JS 异常：' + (M.errs.length ? M.errs.join(' | ') : '无'));
await M.close();
console.log('\n完成。');
