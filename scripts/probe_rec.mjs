/* 真浏览器验证「该请谁教你」：按要学的内容 + 现状推荐导师。
   用法：先起 8899 静态服务与 Edge(9225)，再 node scripts/probe_rec.mjs */
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
/* 只截某个元素：看顶部那排挤没挤坏用这个最直接。
   clip 用的是文档坐标，所以要补上 scrollX/scrollY —— 页面滚过时 GetBoundingClientRect 才是视口坐标。 */
const shotEl = async (sel, f) => {
  const r = await ev(`(function(){var b=document.querySelector('${sel}').getBoundingClientRect();
    return JSON.stringify({x:b.left+window.scrollX,y:b.top+window.scrollY,w:b.width,h:b.height})})()`);
  const b = JSON.parse(r);
  const s = await send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: b.x, y: b.y, width: b.w, height: Math.min(b.h, 900), scale: 1 }
  });
  fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
  console.log('  元素截图 → ' + f + '（' + Math.round(b.w) + '×' + Math.round(b.h) + '）');
};
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8902/index.html' });
await sleep(3000);

/* 干净起步：清掉旧数据，免得上次实验的导师/状态串进来 */
await ev(`(function(){try{localStorage.clear();return 'cleared'}catch(e){return 'EXC '+e.message}})()`);
await send('Page.reload', { ignoreCache: true }); await sleep(3000);

console.log('\n【1. 入口：上课页顶部的「推荐导师」】');
console.log('按钮在:', await ev(`!!document.querySelector('#rgo2')`));
console.log('点它 →', await ev(`(function(){try{document.querySelector('#rgo2').click();return 'ok'}catch(e){return 'EXC '+e.message}})()`));
await sleep(600);
console.log('现在停在:', await ev(`document.querySelector('#v-set').classList.contains('on')?'设置页':'别处'`));
console.log('内容框预填:', JSON.stringify(await ev(`document.querySelector('#rq').value`)));

console.log('\n【2. 按内容推人（真浏览器渲染）】');
const cases = [
  ['定积分的定义、可积的充要条件与反例', '柯西'],
  ['定积分的几何应用：旋转体的体积和弧长', '莱布尼茨'],
  ['微分方程在 RC 电路中的应用，时间常数的物理意义', '牛顿'],
  ['比较判别法的适用条件，什么时候会失效', '相里要'],
  ['矩阵的初等变换与线性方程组同解，解的结构', '长离'],
  ['自定义类型和类型转换的区别，为什么有优先级', '维里奈']
];
for (const [txt, want] of cases) {
  const got = await ev(`(function(){try{
    var q=document.querySelector('#rq');q.value=${JSON.stringify(txt)};
    RSEL=[];renderRout();
    return document.querySelector('#rout .rcname').textContent;
  }catch(e){return 'EXC '+e.message}})()`);
  console.log((got === want ? '  ✓ ' : '  ✗ ') + txt.slice(0, 18) + ' … → ' + got + (got === want ? '' : '（期望 ' + want + '）'));
}

console.log('\n【3. 状态叠加 + 卡片长什么样】');
console.log(await ev(`(function(){try{
  var q=document.querySelector('#rq');q.value='定积分的几何应用：旋转体的体积和弧长';
  RSEL=[];
  document.querySelectorAll('#rst .pill')[1].click();   /* 怕自己其实是假装懂了 */
  document.querySelectorAll('#rst .pill')[7].click();   /* 想知道会怎么考 */
  return '已勾 2 项';
}catch(e){return 'EXC '+e.message}})()`));
await sleep(300);
console.log('主推:', await ev(`document.querySelector('#rout .rcname').textContent`));
console.log('搭配:', await ev(`(document.querySelector('#rout .rcplant')||{}).textContent||'（无）'`));
console.log('理由:', await ev(`document.querySelector('#rout .rcwhy').textContent.slice(0,42)+'…'`));
console.log('开场白:', await ev(`document.querySelector('#rout .rcopen').textContent`));
console.log('备选:', await ev(`[].map.call(document.querySelectorAll('#rout .rcitem b'),function(b){return b.textContent}).join(' / ')||'（无）'`));
await ev(`document.querySelector('#reccard').scrollIntoView({block:'center'})`);
await sleep(400);
await shot('preview-推荐导师.png');

console.log('\n【4. 一键应用】');
console.log('点之前 导师/模式:', await ev(`getP(who).n+' / '+curMode().n`));
console.log(await ev(`(function(){try{document.querySelector('#rout [data-rk]').click();return 'clicked'}catch(e){return 'EXC '+e.message}})()`));
await sleep(500);
console.log('点之后 导师/模式:', await ev(`getP(who).n+' / '+curMode().n`));
console.log('落到哪一页:', await ev(`document.querySelector('#v-lesson').classList.contains('on')?'上课页':'别处'`));
console.log('刷新后还在:', await ev(`(function(){try{return LS.g('who')+' / '+LS.g('mode')}catch(e){return 'EXC '+e.message}})()`));

console.log('\n【5. 没信号时】');
await ev(`goView('set')`); await sleep(300);
console.log(await ev(`(function(){try{
  var q=document.querySelector('#rq');q.value='';RSEL=[];renderRout();
  return document.querySelector('#rout').textContent.slice(0,30);
}catch(e){return 'EXC '+e.message}})()`));
console.log('有没有主推按钮:', await ev(`!!document.querySelector('#rout [data-rk]')`));

console.log('\n【6. 回到内容推荐，看最终形态】');
await ev(`(function(){try{
  var q=document.querySelector('#rq');q.value='比较判别法的适用条件，什么时候会失效';
  RSEL=[];renderRst();renderRout();return 'ok'}catch(e){return 'EXC '+e.message}})()`);
await sleep(300);
console.log('主推:', await ev(`document.querySelector('#rout .rcname').textContent`));
console.log('开场白:', await ev(`document.querySelector('#rout .rcopen').textContent`));
await ev(`document.querySelector('#reccard').scrollIntoView({block:'center'})`);
await sleep(400);
await shot('preview-推荐导师2.png');

console.log('\n【7. 手机宽度】');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(600);
await ev(`document.querySelector('#reccard').scrollIntoView({block:'start'})`);
await sleep(400);
await shot('preview-推荐导师手机.png');

console.log('\n【8. 上课页顶部那排（加了「推荐导师」会不会挤坏）】');
await ev(`goView('lesson')`); await sleep(400);
console.log('手机宽度 390 下顶部 bar 高度:', await ev(`document.querySelector('#v-lesson .bar').getBoundingClientRect().height.toFixed(0)+'px'`));
console.log('bar 有没有横向溢出:', (await ev(`(function(){var b=document.querySelector('#v-lesson .bar');return b.scrollWidth>b.clientWidth})()`)) ? '溢出' : '正常');
console.log('「推荐导师」按钮可见:', await ev(`(function(){var e=document.querySelector('#rgo2');var r=e.getBoundingClientRect();return r.width>0&&r.top<200})()`));
await shot('preview-推荐入口手机.png');
await ev(`(function(){window.scrollTo(0,0);['#msgs','#mw','#stage','#v-lesson'].forEach(function(s){var e=document.querySelector(s);if(e)e.scrollTop=0});return 1})()`);
await sleep(300);
console.log('手机 bar 的 rect:', await ev(`(function(){var b=document.querySelector('#v-lesson .bar').getBoundingClientRect();return Math.round(b.top)+','+Math.round(b.left)+' '+Math.round(b.width)+'x'+Math.round(b.height)})()`));
await shotEl('#v-lesson .bar', 'preview-顶部栏手机.png');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await shotEl('#v-lesson .bar', 'preview-顶部栏.png');

ws.close();
