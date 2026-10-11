/* 用真实浏览器（Edge headless + CDP）实测「刷新后是否停在最后一次对话」。
   jsdom 没有布局，scrollTop/scrollHeight 恒为 0，这类问题只能上真浏览器。

   用法：
     1) 起静态服务器 + 无头浏览器（见 tests/README 或脚本头注释）
     2) node scripts/probe_scroll.mjs [url]

   输出一张时间线：刷新后每 400ms 采一次 scrollTop / scrollHeight / clientHeight / gap / 跟随开关，
   再模拟「内容晚到变高」和「用户滚上去再刷新」两种情况。 */
const PORT = 9223;
const URL = process.argv[2] || 'http://127.0.0.1:8899/index.html';
const STEP = Number(process.argv[3] || 400);
const TOTAL = Number(process.argv[4] || 8000);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  let list = [];
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { }
    if (list.some(t => t.type === 'page' && /^http/.test(t.url || ''))) break;
    await sleep(250);
  }
  const tgt = list.find(t => t.type === 'page' && /^http/.test(t.url || '')) || list.find(t => t.type === 'page');
  if (!tgt) throw new Error('没找到可调试的页面');

  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const waiters = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; waiters.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await sleep(2500);

  const seeded = await ev(`(function(){
    window.__kxevt=0;
    window.addEventListener('katexready',function(){window.__kxevt=Date.now()});
    var ms=[];
    for(var i=0;i<30;i++){
      ms.push({r:'user',c:'第 '+i+' 问：为什么 $a_'+i+'$ 可以这样？'});
      ms.push({r:'assistant',c:'因为它是线性的。\\n\\n$$\\\\int_0^1 x^{'+(i+1)+'} dx=\\\\frac{1}{'+(i+2)+'}$$\\n\\n再看 $b_'+i+'$ 这一步，它保证了结论成立。这是第 '+i+' 轮的说明文字，用来把内容撑高一点。'});
    }
    localStorage.setItem('gx.msgs.__free',JSON.stringify(ms));
    localStorage.setItem('gx.course',JSON.stringify('__free'));
    return ms.length;
  })()`);

  const probe = `(function(){
    var m=document.getElementById('msgs');if(!m)return 'null';
    var bot=m.scrollHeight-m.clientHeight;
    return JSON.stringify({
      top:Math.round(m.scrollTop),h:Math.round(m.scrollHeight),ch:Math.round(m.clientHeight),
      gap:Math.round(m.scrollHeight-m.scrollTop-m.clientHeight),
      atBot:Math.abs(m.scrollTop-bot)<=24,
      pin:(typeof PINB!=='undefined')?PINB:'?',
      kx:(typeof katex!=='undefined')?'ready':'no'
    });
  })()`;

  const T0 = Date.now();
  await ev(`window.__t0=Date.now()`);
  await send('Page.reload');
  console.log('种入消息数 :', seeded);
  console.log('刷新后时间线（gap=距底部还差多少像素，pin=是否在跟随）');
  for (let t = STEP; t <= TOTAL; t += STEP) {
    await sleep(STEP);
    await ev(`window.__t0=window.__t0||Date.now()`);
    console.log(String(t).padStart(5) + 'ms  ' + await ev(probe));
  }

  console.log('');
  console.log('模拟内容晚到：给 #mw 追加 900px 高的块');
  await ev(`(function(){var d=document.createElement('div');d.id='__pad';d.style.height='900px';document.getElementById('mw').appendChild(d)})()`);
  await sleep(400);
  console.log('  追加后        ' + await ev(probe));
  await ev(`(function(){var d=document.getElementById('__pad');if(d)d.remove()})()`);
  await sleep(400);
  console.log('  移除后        ' + await ev(probe));

  console.log('');
  console.log('模拟用户滚上去，再让内容晚到（不该被拽回底部）');
  await ev(`document.getElementById('msgs').scrollTop=200`);
  await sleep(400);
  console.log('  滚到 200      ' + await ev(probe));
  await ev(`(function(){var d=document.createElement('div');d.id='__pad2';d.style.height='900px';document.getElementById('mw').appendChild(d)})()`);
  await sleep(500);
  console.log('  内容长高 900  ' + await ev(probe) + '   <- top 应仍是 200');
  await ev(`(function(){var d=document.getElementById('__pad2');if(d)d.remove()})()`);

  console.log('');
  console.log('用户滚上去之后刷新（应该又落回最后一条）');
  await send('Page.reload');
  for (let t = STEP * 2; t <= 4000; t += STEP * 2) {
    await sleep(STEP * 2);
    console.log(String(t).padStart(5) + 'ms  ' + await ev(probe));
  }

  console.log('');
  console.log('总耗时 ' + Math.round((Date.now() - T0) / 1000) + 's');
  ws.close();
}
main().catch(e => { console.log('出错:', e.message); process.exit(1); });
