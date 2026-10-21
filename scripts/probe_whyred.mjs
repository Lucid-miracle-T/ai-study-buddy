/* 真浏览器 + 真 KaTeX：验证「自己写的 \left| … \right| 变红字」已修好
   1) 先证明红字就是 KaTeX 的报错色（喂它一个残段 \left| 看会不会吐 #cc0000）
   2) 用户那条原话走一遍 md()，看还有没有残段 / 红字
   3) 当成一条真消息插进对话，截图
   用法：node scripts/probe_whyred.mjs */
const PORT = process.env.PROBE_PORT || 9227;
const APP = process.env.PROBE_URL || 'http://127.0.0.1:8902/index.html';
const fs = await import('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 直接开一个全新标签页，带上时间戳绕开缓存 ——
   否则 Edge 会拿上一轮缓存的 index.html，验的还是旧代码 */
const bust = APP + (APP.includes('?') ? '&' : '?') + 't=' + Date.now();
const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=${encodeURIComponent(bust)}`, { method: 'PUT' })).json();
console.log('开新标签页：' + nt.url);
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
const shot = async (f, clip) => {
  const p = { format: 'png', captureBeyondViewport: true };
  if (clip) p.clip = clip;
  const s = await send('Page.captureScreenshot', p);
  fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
  console.log('  截图 → ' + f);
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: bust });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('typeof md==="function" && typeof katex!=="undefined" && !!document.getElementById("mw")')) break; await sleep(300) }
console.log('katex:', await ev('typeof katex'), ' md:', await ev('typeof md'), ' 消息容器:', await ev('!!document.getElementById("mw")'));

/* 用户那条原话（中间一层是符号面板的「绝对值」模板，外面又被套了一层） */
const MSG = '任意ε>0，存在N∈$N^{+}$，使$\\left| $\\left| x_{n}-a \\right|$ \\right|$<ε';

console.log('\n【1】红字的来历：把一个残段交给 KaTeX');
const kx = await ev(`(function(){
  var bad=katex.renderToString('\\\\left| ',{displayMode:false,throwOnError:false});
  var good=katex.renderToString('\\\\left| x \\\\right|',{displayMode:false,throwOnError:false});
  return JSON.stringify({badHasErr:/katex-error/.test(bad),badColor:(bad.match(/color:\\s*#?[0-9a-fA-F]+/)||[''])[0],badText:bad.replace(/<[^>]+>/g,''),goodHasErr:/katex-error/.test(good)});
})()`);
const k = JSON.parse(kx);
console.log('  残段 \\left|        → katex-error=' + k.badHasErr + '  色=' + k.badColor + '  吐回原文=' + JSON.stringify(k.badText));
console.log('  完整的 \\left| x \\right| → katex-error=' + k.goodHasErr);
const kxsrc = await ev(`(function(){
  var c=document.createElement('div');document.body.appendChild(c);
  c.innerHTML=katex.renderToString('\\\\left| ',{throwOnError:false});
  var s=c.querySelector('.katex-error');
  var col=s?getComputedStyle(s).color:'(没找到 .katex-error)';
  c.remove();return col})()`);
console.log('  浏览器算出的颜色 = ' + kxsrc + '（对比截图里那两个红块）');

console.log('\n【2】用户那条消息走一遍 md()');
const html = await ev('md(' + JSON.stringify(MSG) + ')') || '';
console.log('  md() 里有 katex-error 吗 : ' + /katex-error/.test(html));
console.log('  还有裸 LaTeX 源码吗      : ' + /\\left|\\right/.test(html.replace(/<[^>]*>/g, '')));
console.log('  渲染出的公式块           : ' + await ev(`(function(){var d=document.createElement('div');d.innerHTML=${JSON.stringify(html)};return d.querySelectorAll('.katex').length})()`));

console.log('\n【3】当成一条真消息插进对话');
console.log(await ev(`(function(){try{
  goView('lesson');
  var box=document.getElementById('mw'); if(!box)return '找不到 #mw';
  box.innerHTML=''; MS=[];
  addMsg('user',${JSON.stringify(MSG)},0);
  return '已插入，容器里有 ' + box.querySelectorAll('.msg').length + ' 条';
}catch(e){return 'EXC '+e.message}})()`));
await sleep(600);
console.log('  这条消息里的报错块 : ' + await ev(`document.querySelectorAll('#mw .katex-error').length`));
console.log('  这条消息里的公式块 : ' + await ev(`document.querySelectorAll('#mw .katex').length`));
console.log('  正文文字           : ' + JSON.stringify(await ev(`(function(){var m=document.querySelector('#mw .msg');return m?m.querySelector('.body').textContent:''})()`)));
console.log('  红色文字节点       : ' + await ev(`(function(){
  var m=document.querySelector('#mw .msg');if(!m)return '无消息';
  var reds=[];(function walk(n){if(n.nodeType===3){if(n.nodeValue.trim()&&getComputedStyle(n.parentElement).color==='rgb(204, 0, 0)')reds.push(n.nodeValue)}else if(n.nodeType===1){for(var i=0;i<n.childNodes.length;i++)walk(n.childNodes[i])}})(m);
  return JSON.stringify(reds)})()`));

const b = JSON.parse(await ev(`(function(){var r=document.querySelector('#mw .msg').getBoundingClientRect();return JSON.stringify({x:r.left-10,y:r.top-6,w:r.width+20,h:r.height+12})})()`));
await shot('preview-公式已修好.png', { x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.w, height: b.h, scale: 1 });

console.log('\n【4】真点一次符号面板（这才是当初出事的入口）');
console.log(await ev(`(function(){try{
  goView('lesson');
  var ta=document.getElementById('in'); ta.value='使'; ta.selectionStart=ta.selectionEnd=1;
  SYMA=1;SYMT='tmpl';renderSym();
  var bs=[].slice.call(document.querySelectorAll('#symgrids .symgrid.on .symbtn'));
  var ab=bs.filter(function(x){return x.textContent==='绝对值'})[0];
  if(!ab)return '找不到「绝对值」按钮';
  ab.click();
  var after1=ta.value, sel1=[ta.selectionStart,ta.selectionEnd];
  ab.click();                       /* 第二次：光标正停在占位字母上 */
  return JSON.stringify({第一次:after1,选中:sel1,第二次:ta.value,
    dollar数:(ta.value.match(/\\$/g)||[]).length});
}catch(e){return 'EXC '+e.message}})()`));
const afterClick = await ev(`(function(){
  var t=document.getElementById('in').value, d=document.createElement('div');
  d.innerHTML=md(t); return JSON.stringify({有报错块:/katex-error/.test(d.innerHTML)})})()`);
console.log('  这样写出来的整串走 md()：' + afterClick);

console.log('\n【异常】', errs.length ? errs.slice(0, 3) : '无');
ws.close();
console.log('完成。');
