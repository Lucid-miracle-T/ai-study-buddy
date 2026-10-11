/* 用真实浏览器检查闪卡的公式渲染。
   用法：先起 8899 静态服务与 Edge(9225)，再 node scripts/probe_cards.mjs */
const PORT = 9225;
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
  if (r.result && r.result.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || JSON.stringify(r.result.exceptionDetails));
  return r.result && r.result.result ? r.result.result.value : undefined;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:8899/index.html' });
await sleep(3500);

const cards = [
  { q: '行内公式：设 $A$ 为 $n$ 阶方阵，则 $|A^T|=|A|$。', a: '行列式转置不变：$|A^{T}|=|A|$' },
  { q: '独立公式：$$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$', a: '$$\\sum_{k=1}^{n}k=\\frac{n(n+1)}{2}$$' },
  { q: '带换行\n$$\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}=ad-bc$$', a: '按第一行展开：$a\\cdot d-b\\cdot c$' },
  { q: '中文紧贴公式$a_{ij}$不加空格，右侧紧邻：$x$的系数', a: '一个 $ 单独出现算不算？' },
  { q: '很长的一段题干，用来模拟被截断的情况：$$\\lambda_1 x_1+\\lambda_2 x_2+\\lambda_3 x_3+\\lambda_4 x_4+\\lambda_5 x_5=\\mu_1 y_1+\\mu_2 y_2+\\mu_3 y_3$$', a: '短答' }
];

console.log('注入:', await ev(`(function(){try{
  CD=${JSON.stringify(cards.map((c, i) => ({ id: 'p' + i, q: c.q, a: c.a, box: 0, due: 0, c: '__free' })))};
  LS.s('cards',CD); rev=null; revBack=false; COURSE='__free';
  document.querySelector('[data-v="card"]').click();
  return 'cards='+CD.length+'  course='+COURSE+'  cardList='+cardList().length;
}catch(e){return 'EXC '+e.message}})()`));
await sleep(600);

console.log('\n【复习区 问题面】');
console.log(await ev(`document.getElementById('car').innerHTML`));
console.log('\n【点「看答案」】');
console.log(await ev(`(function(){var b=document.getElementById('cf2');if(!b)return '没有看答案按钮';b.click();return 'clicked'})()`));
await sleep(400);
console.log(await ev(`document.getElementById('car').innerHTML`));

console.log('\n【卡片列表 innerHTML】（长度 ' + await ev(`document.getElementById('clist').innerHTML.length`) + '）');
console.log(await ev(`document.getElementById('clist').innerHTML`));
console.log('\n【列表里第一张卡的可见文字】');
console.log(await ev(`(document.querySelector('#clist .crow')||{innerText:'(无)'}).innerText`));

console.log('\n【开始复习 → 点卡片】');
console.log(await ev(`(function(){var b=document.getElementById('review');if(!b)return '无 review 按钮';b.click();return 'clicked'})()`));
await sleep(500);
console.log('rev=' + await ev(`rev`) + '  问题面文字: ' + await ev(`(document.getElementById('car').innerText||'').replace(/\\n/g,' | ')`));

console.log('\n【每张卡列表摘要（可见文字）】');
console.log(await ev(`[].map.call(document.querySelectorAll('#clist .crow .q'),function(e){return e.textContent}).join('\\n')`));
console.log('\n【clipTex 边界（截到 12 字）】');
for (const s of ['$$a+b$$ 尾巴', '$$\\lambda_1 x_1+\\lambda_2 x_2+\\lambda_3 x_3$$', '行内 $x^2$ 与 $y$ 后面还有很多字', '没有公式的一段很长很长很长的话']) {
  console.log('  ' + JSON.stringify(s), '→', JSON.stringify(await ev(`clipTex(${JSON.stringify(s)},12)`)));
}
console.log('\n【clipTex 在列表里是否渲染出 katex】');
console.log('第二张卡（独立公式）：', await ev(`document.querySelectorAll('#clist .crow')[1].querySelectorAll('.katex').length`), '个 katex');
console.log('第五张卡（长公式，被截）：', await ev(`document.querySelectorAll('#clist .crow')[4].querySelectorAll('.katex').length`), '个 katex');
console.log('第五张卡可见文字：', await ev(`document.querySelectorAll('#clist .crow')[4].querySelector('.q').textContent`));
ws.close();
