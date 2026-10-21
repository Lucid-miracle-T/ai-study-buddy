/* 教材页体检：导航 → 渲染 → 真实点击每一层 → 全量逐节渲染，一次跑完。
   用法：先起 8902 静态服务与 Edge(9225)，再 node scripts/probe_book.mjs
   可选：PROBE_URL=https://... 测线上；PROBE_KEEP=1 保留已有数据（默认清空，走首次打开） */
const PORT = process.env.PROBE_PORT || 9225;
const URL_ = process.env.PROBE_URL || 'http://127.0.0.1:8902/index.html';
const KEEP = !!process.env.PROBE_KEEP;
const fs = await import('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tgt = list.find(t => t.type === 'page' && /^http/.test(t.url || ''));
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let id = 0; const waiters = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push((d.exception && (d.exception.description || d.exception.value)) || d.text) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('[console] ' + m.params.args.map(a => a.value || a.description || '').join(' '));
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  const ex = r.result && r.result.exceptionDetails;
  if (ex) return 'EXC: ' + (ex.exception && (ex.exception.description || ex.exception.value) || '');
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const shot = async f => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(f, Buffer.from(s.result.data, 'base64')); console.log('  截图 → ' + f) };
const realClick = async (sel, idx) => {
  const j = await ev(`(function(){var es=document.querySelectorAll('${sel}');var el=es[${idx}];if(!el)return '';
    el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`);
  if (!j) return false;
  const p = JSON.parse(j);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  return true;
};
const cnt = () => ev(`document.querySelectorAll('#blist .cgrp').length+' 组 / '+document.querySelectorAll('#blist .grp').length+' 分册 / '+document.querySelectorAll('#blist .item').length+' 节'`);

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_ });
await sleep(5000);
if (!KEEP) { await ev('(function(){try{localStorage.clear()}catch(e){}})()'); await send('Page.reload', { ignoreCache: true }); }

let ready = false;
for (let i = 0; i < 30; i++) { if (await ev(`typeof CH==='object'&&CH.length>0`) === true) { ready = true; break } await sleep(1000) }
console.log('地址:', URL_, '\n页面就绪:', ready, ' 教材节数 CH.length:', await ev('CH.length'));
if (!ready) { console.log('未就绪，退出；异常:', errs.slice(0, 5)); ws.close(); process.exit(0) }

console.log('\n【1. 点导航「教材」】');
await ev(`document.querySelector('.nv button[data-v="book"]').click()`); await sleep(700);
console.log('  视图:', await ev(`document.querySelector('section.view.on').id`), ' | ', await cnt(), ' | bstat:', await ev(`(document.querySelector('#bstat')||{}).textContent`));

console.log('\n【2. 真实点击：课程组 → 分册 → 章节 → 勾选框】');
const cg = await ev(`document.querySelector('#blist .cgrp h3')?'有':'无'`);
if (cg === '有') { await realClick('#blist .cgrp h3', 0); await sleep(500); console.log('  收起/展开课程组后:', await cnt()) }
await realClick('#blist .grp h3', 0); await sleep(800);
console.log('  点分册后:', await cnt());
await realClick('#blist .item', 0); await sleep(800);
console.log('  点第一节后: curCh=' + await ev(`typeof curCh!=='undefined'?curCh:'?'`) + '  #rw 字数=' + await ev(`((document.querySelector('#rw')||{}).textContent||'').length`));
console.log('  点勾选框后: CTX=' + (await realClick('#blist .item .ck', 0), await sleep(500), await ev('CTX.length')));

console.log('\n【3. 搜索过滤】');
console.log('  ' + await ev(`(function(){var q=document.querySelector('#bq');q.value='行列式';q.dispatchEvent(new Event('input',{bubbles:true}));return '输入“行列式”'})()`));
await sleep(1200);
console.log('  过滤后:', await cnt());
await ev(`(function(){var q=document.querySelector('#bq');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(500);

console.log('\n【4. 遮挡检查（elementFromPoint）】');
for (const [sel, idx, name] of [['.nv button', 1, '导航教材'], ['#bq', 0, '搜索框'], ['#reload', 0, '载入全部'], ['#ldg', 0, '仅高数'], ['#pickfile', 0, '导入教材'], ['#blist .item', 0, '第一节']]) {
  console.log('  ' + name + ': ' + await ev(`(function(){var el=document.querySelectorAll('${sel}')[${idx}];if(!el)return '不存在';
    el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();if(!r.width||!r.height)return '尺寸 0';
    var t=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));
    return t===el?'✓ 就是它':(el.contains(t)?'△ 子元素':'✗ 被 '+(t?t.tagName.toLowerCase()+(t.id?'#'+t.id:''):'视口外')+' 挡住')})()`));
}

console.log('\n【5. 全量逐节 openCh（找渲染抛异常的那一节）】');
console.log('  ' + await ev(`(function(){var bad=[],ok=0;for(var i=0;i<CH.length;i++){var c=CH[i];
  try{openCh(c);ok++}catch(e){bad.push(c.file+'#'+c.id+' → '+String(e&&e.message||e).slice(0,90))}if(bad.length>8)break}
  return '成功 '+ok+' 节，失败 '+bad.length+' 节'+(bad.length?'\\n    '+bad.join('\\n    '):'')})()`));
console.log('  标题渲染: ' + await ev(`(function(){var b=[];for(var i=0;i<CH.length;i++){try{titleHtml(CH[i].title)}catch(e){b.push(CH[i].title);if(b.length>5)break}}return b.length?('✗ '+b.length+' 个标题抛异常'):('✓ 全部 '+CH.length+' 个标题安全')})()`));

console.log('\n【6. 各宽度下「教材」按钮是否可点】');
for (const w of [360, 480, 640, 700, 768, 1024, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: w < 700 }); await sleep(400);
  await ev(`document.querySelector('.nv button[data-v="lesson"]').click()`); await sleep(200);
  console.log('  ' + String(w).padEnd(5) + 'px: ' + await ev(`(function(){var b=document.querySelector('.nv button[data-v="book"]');var r=b.getBoundingClientRect();
    var cx=Math.round(r.left+r.width/2),cy=Math.round(r.top+r.height/2);
    if(cx<0||cx>innerWidth||cy<0||cy>innerHeight)return '★ 在视口外 ★';
    var t=document.elementFromPoint(cx,cy);return t===b?'✓ 可点':'✗ 被 '+(t?t.tagName.toLowerCase()+(t.id?'#'+t.id:''):'空')+' 挡住'})()`));
}
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(400);
await ev(`document.querySelector('.nv button[data-v="book"]').click()`); await sleep(600);
await shot('preview-教材诊断.png');

console.log('\n【7. 页面异常汇总】');
console.log(errs.length ? errs.slice(0, 10).join('\n') : '（全程无异常）');
ws.close();
