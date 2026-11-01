/* 真浏览器验证「切节时章节勾选跟着换」
   用户报：点开每一节，顶部那排章节 chip 都一样，不跟着节走。
   这里直接对线上站跑两种情形：
     A. 每节都有自己的 ch（新数据）→ chip 应当各不相同
     B. 每节都没有 ch（升级前的老数据）→ 全部回落课程级 CTX0，看起来一模一样
   用法：先起 Edge(9231)，再 node scripts/probe_sessctx.mjs */
const PORT = 9231, fs = await import('fs'), os = await import('os'), path = await import('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const URL0 = 'http://127.0.0.1:8902/index.html';

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tgt = list.find(t => t.type === 'page' && /^http/.test(t.url || '')) || list.find(t => t.type === 'page');
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
  const p = path.join(os.tmpdir(), f);
  fs.writeFileSync(p, Buffer.from(s.result.data, 'base64'));
  console.log('  截图 → ' + p);
};

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL0 });
await sleep(4000);
/* 教材是异步一批批读进来的，读的过程中会重画、还可能回落课程 —— 等它稳定再注入，
   否则注入的 SESS 会被随后的 loadCourseData 盖掉（上一版探针就栽在这儿）。 */
{ let last=-1, same=0;
  for (let i=0;i<40;i++){ const n=await ev('CH.length'); if(n===last&&n>0)same++; else same=0; last=n; if(same>=3)break; await sleep(700); }
  console.log('等教材稳定，共 ' + last + ' 节');
}

console.log('线上版本认得 applySessCtx:', await ev('typeof applySessCtx'));
console.log('已载入教材节数:', await ev('CH.length'));

/* 造三章 + 三节，每节各带不同的一章 */
const setup = `(function(){
  CH=[{id:"X.md#5",file:"X.md",level:2,title:"第五节 极限运算法则",txt:"五"},
      {id:"X.md#6",file:"X.md",level:2,title:"第六节 极限存在准则 两个重要极限",txt:"六"},
      {id:"X.md#7",file:"X.md",level:2,title:"第七节 无穷小的比较",txt:"七"}];
  SESS=[{id:"s1",t:1,title:"一",who:"cauchy",ch:["X.md#5"]},
        {id:"s2",t:2,title:"二",who:"cauchy",ch:["X.md#6"]},
        {id:"s3",t:3,title:"三",who:"cauchy",ch:["X.md#7"]}];
  CURS="s1";saveSess();MS=[{r:"user",c:"a",s:"s1"},{r:"user",c:"b",s:"s2"},{r:"user",c:"c",s:"s3"}];saveMs();
  return "ok";
})()`;
console.log('\n准备数据:', await ev(setup));

const chips = async () => JSON.stringify(await ev(`Array.from(document.querySelectorAll('#ctxchips .chip')).map(function(c){return c.textContent.replace('×','')})`));

console.log('\n【A. 每节各有 ch —— 应当各不一样】');
for (const s of ['s2', 's1', 's3']) {
  await ev(`switchSess("${s}")`); await sleep(400);
  console.log('  切到 ' + s + ' → chips', await chips(), '| CTX=' + await ev('JSON.stringify(CTX)'));
}
await shot('sessctx_A.png');

console.log('\n【B. 老数据：三节都没有 ch，课程级 CTX0 有值 —— 会不会都一样？】');
console.log(await ev(`(function(){
  SESS=[{id:"s1",t:1,title:"一"},{id:"s2",t:2,title:"二"},{id:"s3",t:3,title:"三"}];
  CURS="s1";saveSess();CTX0=["X.md#5","X.md#6","X.md#7"];CTX=CTX0.slice();return "ok"})()`));
for (const s of ['s1', 's2', 's3']) {
  await ev(`switchSess("${s}")`); await sleep(400);
  console.log('  切到 ' + s + ' → chips', await chips(), '| 这节有 ch?', await ev(`!!(sessOf("${s}")||{}).ch`));
}
await shot('sessctx_B.png');

console.log('\n【C. 在 s2 勾一章，再看 s1/s3 会不会被牵连】');
await ev('switchSess("s1")'); await sleep(200);
await ev('switchSess("s2")'); await sleep(200);
await ev('toggleCtx("X.md#7")'); await sleep(300);
console.log('  s2 勾完 chips', await chips(), '| s2.ch=' + await ev('JSON.stringify((sessOf("s2")||{}).ch)'));
await ev('switchSess("s1")'); await sleep(300);
console.log('  回 s1 → chips', await chips(), '| s1.ch=' + await ev('JSON.stringify((sessOf("s1")||{}).ch)'));
await ev('switchSess("s3")'); await sleep(300);
console.log('  到 s3 → chips', await chips(), '| s3.ch=' + await ev('JSON.stringify((sessOf("s3")||{}).ch)'));

console.log('\n【D. 节条 / 教材页提示】');
console.log('  #stabs 文本:', JSON.stringify(await ev(`(document.querySelector('#stabs')||{}).textContent`)));
console.log('  第一节 title:', JSON.stringify(await ev(`(document.querySelector('.stab[data-s="s1"]')||{}).title`)));
console.log('  教材页提示:', JSON.stringify(await ev(`(document.getElementById('bsess')||{}).textContent`)));

ws.close();
