/* 手机端布局体检（390×844）。jsdom 不做媒体查询、没有布局引擎，
   所以这些「输入框在不在视口里」「工具栏多高」的问题只能开真浏览器量。

   用法：
     1) 在仓库根目录起静态服务：node <静态服务脚本>，监听 8902
     2) Edge --headless=new --remote-debugging-port=9231 --remote-allow-origins=*
     3) node scripts/probe_mobile.mjs

   检查点：
   - 上课页：输入栏底边 ≤ 视口高；折叠后的工具条只有一行；点摘要能展开导师/模式
   - 教材页：选章后目录收起、正文高度 ≥ 400；点「目录」能展开
   - 网课页：选讲后目录收起、正文高度 ≥ 450
   - 各视图没有把页面撑出横向滚动
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 9231, URL_SITE = 'http://127.0.0.1:8902/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) failed++; };

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tgt = list.find(t => t.type === 'page' && /8902/.test(t.url || '')) || list.find(t => t.type === 'page');
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let id = 0; const waiters = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  const ex = r.result && r.result.exceptionDetails;
  if (ex) return 'EXC: ' + (ex.exception && (ex.exception.description || ex.exception.value) || '');
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const rect = sel => `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {t:Math.round(r.top),h:Math.round(r.height),b:Math.round(r.bottom),d:getComputedStyle(e).display}})()`;

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send('Page.navigate', { url: URL_SITE });
await sleep(3000);
await ev('localStorage.clear()');           /* 从新用户默认状态量 */
await send('Page.reload', { ignoreCache: true });
await sleep(9000);

const outDir = path.join(os.tmpdir(), 'gx-mobile-shots');
fs.mkdirSync(outDir, { recursive: true });
const shot = async name => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'));
};

console.log('视口:', await ev(`innerWidth + '×' + innerHeight`));

console.log('\n[上课页]');
await ev(`goView('lesson')`); await sleep(500);
const vh = await ev('innerHeight');
const bar1 = await ev(rect('#lbar1'));
const inbar = await ev(rect('#inbar'));
const msgs = await ev(rect('#msgs'));
ok(bar1 && bar1.h <= 60, `导师/模式默认折叠成一行（实际 ${bar1 && bar1.h}px）`);
ok(inbar && inbar.b <= vh + 1, `输入栏在视口内（底边 ${inbar && inbar.b} ≤ ${vh}）`);
ok(msgs && msgs.h >= 300, `对话区保留足够高度（实际 ${msgs && msgs.h}px）`);
await ev(`$('mctrl').click()`); await sleep(300);
const pbox = await ev(rect('#pbox'));
ok(pbox && pbox.d === 'flex' && pbox.h > 0, '点摘要能展开导师列表');
await shot('lesson-open.png');
await ev(`$('mctrl').click()`); await sleep(300);
await shot('lesson.png');

console.log('\n[教材页]');
await ev(`goView('book')`); await sleep(1000);
await ev(`$('bwrap').classList.remove('toc-off')`);
await ev(`document.querySelector('#blist .grp>h3').click()`); await sleep(500);
const items = await ev(`document.querySelectorAll('#blist .item').length`);
ok(items > 0, `目录能展开出章节（${items} 节）`);
await ev(`document.querySelector('#blist .item').click()`); await sleep(600);
const reader = await ev(rect('#reader'));
const blist = await ev(rect('#blist'));
ok(blist && blist.d === 'none', '选章后目录自动收起');
ok(reader && reader.h >= 400, `正文拿满高度（实际 ${reader && reader.h}px）`);
await shot('book-reader.png');
await ev(`$('btoc').click()`); await sleep(300);
ok((await ev(rect('#blist'))).d !== 'none', '点「目录」能重新展开');

console.log('\n[网课页]');
await ev(`goView('vid')`); await sleep(1000);
const vlec = await ev(`document.querySelectorAll('#vlist .vlec').length`);
ok(vlec > 0, `网课列表有内容（${vlec} 讲）`);
await ev(`document.querySelector('#vlist .vlec').click()`); await sleep(600);
const vdoc = await ev(rect('#vdoc'));
ok((await ev(rect('#vlist'))).d === 'none', '选讲后目录自动收起');
ok(vdoc && vdoc.h >= 450, `讲义拿满高度（实际 ${vdoc && vdoc.h}px）`);
await shot('vid.png');

console.log('\n[横向溢出]');
for (const v of ['lesson', 'book', 'vid', 'card', 'prog', 'set']) {
  await ev(`goView('${v}')`); await sleep(300);
  const d = await ev(`({vw:innerWidth, doc:document.documentElement.scrollWidth, body:document.body.scrollWidth})`);
  ok(d.doc <= d.vw && d.body <= d.vw, `${v}: 页面没有横向溢出（${d.doc}/${d.body} ≤ ${d.vw}）`);
}

console.log('\n截图 →', outDir);
console.log(failed ? `\n${failed} 项没通过` : '\n全部通过');
ws.close();
process.exit(failed ? 1 : 0);
