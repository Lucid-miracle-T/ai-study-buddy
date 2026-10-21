/* 真浏览器验证「网课刷新后接着看」：合集 / 第几讲 / 带到课堂 / 待在哪一页。
   用法：先起 8902 静态服务与 Edge(9225)，再 node scripts/probe_vpos.mjs */
const PORT = 9225, fs = await import('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tgt = list.find(t => t.type === 'page' && /^http/.test(t.url || ''));
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
const shot = async f => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
  console.log('  截图 → ' + f);
};
const reload = async ms => { await send('Page.reload', { ignoreCache: true }); await sleep(ms || 5000) };

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8902/index.html' });
await sleep(3500);
await ev(`(function(){try{localStorage.clear();return 'cleared'}catch(e){return 'EXC '+e.message}})()`);
await reload(6000);

const snap = k => ev(`(function(){return JSON.stringify({
  view:document.querySelector('section.view.on').id,
  set:VSET, lec:VLEC,
  ctx:VCTX?VCTX.k:null, ctxDoc:VCTX?(VCTX.doc||'').slice(0,14):null,
  lecOn:(document.querySelector('#vlist .vlec.on')||{}).textContent||'',
  lsSet:LS.g('vpos.set',''), lsLec:LS.g('vpos.lec',''), lsCtx:LS.g('vpos.ctx',''), lsView:LS.g('view','')
})})()`).then(s => { console.log('  ' + k + ': ' + s); return JSON.parse(s) });

console.log('\n【0. 内置网课包载入情况】');
console.log('合集数:', await ev('VS.length'), ' 第一份:', await ev('VS[0]?VS[0].title:""'));

console.log('\n【1. 进网课页，换到第一个合集，挑一讲有讲义的（截图才看得出东西）】');
console.log(await ev(`(function(){try{document.querySelector('[data-v="vid"]').click();return 'on vid'}catch(e){return 'EXC '+e.message}})()`));
await sleep(600);
console.log(await ev(`(function(){try{
  var s=document.querySelector('#vset');s.value=s.options[0].value;s.onchange();
  var items=vCur().items,i=items.findIndex(function(x){return String(x.doc||'').length>300});
  if(i<0)i=4;
  document.querySelectorAll('#vlist .vlec')[i].click();
  return '合集='+vCur().title+' / 第 '+(i+1)+' 讲 '+items[i].t+' / 讲义 '+String(items[i].doc||'').length+' 字';
}catch(e){return 'EXC '+e.message}})()`));
await sleep(500);
console.log(await ev(`(function(){try{
  document.querySelector('#vbar2 [data-a="ctx"]').click();
  return '带到课堂='+(VCTX?VCTX.k:'（失败）');
}catch(e){return 'EXC '+e.message}})()`));
await sleep(400);
const before = await snap('刷新前');

console.log('\n【2. 真刷新】');
await reload(6000);
const after = await snap('刷新后');
const chk = (a, b, m) => console.log((a === b ? '  ✓ ' : '  ✗ ') + m + '（' + JSON.stringify(a) + (a === b ? '' : ' ≠ ' + JSON.stringify(b)) + '）');
chk(after.view, 'v-vid', '停在网课页');
chk(after.set, before.set, '还在同一个合集');
chk(after.lec, before.lec, '还停在第 5 讲');
chk(after.ctx, before.ctx, '「带到课堂」的上下文还在');
chk(after.ctxDoc, before.ctxDoc, '讲义正文按 key 重建了');
console.log('  课表高亮行:', JSON.stringify(after.lecOn.trim().slice(0, 20)));
console.log('  按钮:', await ev(`(function(){var b=document.querySelector('#vbar2 [data-a="ctx"]');return b?b.textContent:'（没有）'})()`));
console.log('  左侧下拉当前值:', await ev(`document.querySelector('#vset').value===VSET`));
console.log('  讲义区显示的是当前讲的正文:', await ev(`document.querySelector('#vdoc').textContent.indexOf((vCur().items[VLEC]||{}).t.slice(0,6))>=0`));
console.log('  localStorage 里有正文吗:', await ev(`String(localStorage.getItem('gx.vpos.ctx')).length>40`));
await shot('preview-网课刷新.png');

console.log('\n【3. 再刷一次（位置不漂）+ 设置页不覆盖】');
await reload(6000);
const again = await snap('第二次刷新后');
chk(again.lec, before.lec, '点位没漂');
console.log(await ev(`(function(){document.querySelector('[data-v="set"]').click();return 'view 记录='+LS.g('view','')})()`));
await reload(6000);
chk((await snap('从设置页刷新')).view, 'v-vid', '从设置页刷新回到的是网课现场');

console.log('\n【4. 一百多讲的合集，选中行会不会被拉回视野】');
console.log('课表行数:', await ev(`document.querySelectorAll('#vlist .vlec').length`));
console.log('选中行在视野内:', await ev(`(function(){
  var b=document.querySelector('#vlist'),e=document.querySelector('#vlist .vlec.on');
  if(!b||!e)return 'no';var br=b.getBoundingClientRect(),er=e.getBoundingClientRect();
  return er.top>=br.top-1&&er.bottom<=br.bottom+1})()`));

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(700);
await shot('preview-网课刷新手机.png');
ws.close();
