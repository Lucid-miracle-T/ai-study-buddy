/* 拍题上传：把题目拍下来直接丢给导师看
 *
 * 背景：学习场景里最常见的一步是「这道题怎么做」——用户手上是一本纸质教辅，
 * 让他把整道题一个字一个字敲进输入框，既不现实也容易出错。所以要能拍照上传。
 *
 * 关键约束（不是随便塞一张图进去就行）：
 *   1. 发给模型必须换成多模态格式（content 由字符串变成 [{text},{image_url}]）；
 *      但**没图的消息必须保持字符串**——纯文本模型收到数组会直接 400。
 *   2. 图片必须压缩后存：手机原图 4–8MB，localStorage 上限约 5MB，直接存会当场爆。
 *   3. 图要存进那条消息（message.img），刷新/切节回来还在，也要跟着备份走。
 *   4. 有图没写字也得能发（题在图里，没什么可写的）。
 *   5. 编辑重发别把图弄丢——否则改个错别字就得重新拍一次。
 *
 * 断言：
 *   1. 入口齐全（📷 按钮 / accept=image/* 的 file 框 / 预览位）
 *   2. packContent：无图 → 字符串；有图 → 多模态数组；有图无字 → 文字不为空
 *   3. shrinkImg：等比缩到最长边 ≤1200、转 JPEG、先铺白底、小图不放大
 *   4. 发送：有图无字能发；发完清干净（PEND/输入框/缩略图）
 *   5. 渲染：对话里出现题目图；点开看大图、再点关掉
 *   6. 真正发出去的请求体里，带图那条是多模态数组，不带图那条还是字符串
 *   7. 编辑重发仍带着原来的图
 *   8. 接线检查
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const HTML = () => SRC().replace(/<script src="https:[^"]+"><\/script>/g, '');

function installIDB(win) {
  const m = new Map();
  win.indexedDB = {
    open(n) {
      if (!m.has(n)) m.set(n, new Map());
      const s = m.get(n); const r = {};
      const db = {
        objectStoreNames: { contains: () => true }, createObjectStore() { return {} },
        transaction() {
          const os = {
            put: o => { s.set(o.id, o); return {} }, getAll: () => ({ result: [...s.values()] }),
            delete: id => { s.delete(id); return {} }, clear: () => { s.clear(); return {} }
          };
          const t = { objectStore: () => os };
          setTimeout(() => { if (t.oncomplete) t.oncomplete(); }, 0); return t;
        }
      };
      setTimeout(() => { r.result = db; if (r.onsuccess) r.onsuccess({ target: { result: db } }); }, 0);
      return r;
    }
  };
}

/* jsdom 没有真正的图像解码与 canvas，这里换成可控的替身：
   只关心「算出来的画布尺寸、导出格式、有没有铺白底」，不关心像素内容。 */
function boot(opts) {
  opts = opts || {};
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    if (/Not implemented: HTMLCanvasElement/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true; win.alert = () => {};
      win.open = () => null;
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      /* ask() 里要 new TextDecoder() 解流 */
      try { win.TextDecoder = TextDecoder; } catch (e) { }
      try { win.TextEncoder = TextEncoder; } catch (e) { }

      win.__imgW = opts.w === undefined ? 3000 : opts.w;
      win.__imgH = opts.h === undefined ? 2000 : opts.h;

      win.FileReader = function () {
        const self = this;
        this.readAsDataURL = function () {
          setTimeout(function () { self.result = 'data:image/png;base64,SRC'; if (self.onload) self.onload(); }, 0);
        };
      };
      win.Image = function () {
        const self = this;
        setTimeout(function () {
          self.naturalWidth = win.__imgW; self.naturalHeight = win.__imgH;
          if (self.onload) self.onload();
        }, 0);
        return self;
      };
      win.__paint = [];
      win.HTMLCanvasElement.prototype.getContext = function () {
        return {
          fillStyle: '', fillRect: function (x, y, w, h) { win.__paint.push(['rect', w, h]); },
          drawImage: function () { win.__paint.push(['img']); }
        };
      };
      /* 记下每次导出用的尺寸与参数 */
      win.__exports = [];
      const origCreate = win.document.createElement.bind(win.document);
      win.document.createElement = function (tag) {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === 'canvas') {
          el.toDataURL = function (type, q) {
            win.__exports.push({ w: this.width, h: this.height, type: type, q: q });
            return 'data:image/jpeg;base64,OUT' + win.__exports.length;
          };
        }
        return el;
      };

      if (opts.net) {
        win.fetch = function (url, o) {
          win.__sent = JSON.parse(o.body);
          const line = 'data: {"choices":[{"delta":{"content":"看到了。"}}]}\n\ndata: [DONE]\n\n';
          const bytes = new Uint8Array(Buffer.from(line, 'utf8'));
          let done = false;
          return Promise.resolve({
            ok: true, status: 200, statusText: 'OK',
            body: { getReader: function () { return { read: function () { if (done) return Promise.resolve({ done: true }); done = true; return Promise.resolve({ done: false, value: bytes }); } }; } }
          });
        };
      } else {
        win.fetch = () => Promise.reject(new Error('测试不联网'));
      }
    }
  });
  return { wnd: dom.window, errs };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const IMG = 'data:image/jpeg;base64,ZZZ';

  /* ================= A. 纯函数与压缩 ================= */
  {
    const { wnd, errs } = boot();
    const doc = wnd.document;
    await wait(700);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };

    log('=== 1. 入口齐全 ===');
    ok(!!doc.querySelector('#photo'), '有 📷 按钮');
    ok(!!doc.querySelector('#imgf'), '有隐藏的文件框');
    ok(/image\/\*/.test(doc.querySelector('#imgf').getAttribute('accept') || ''), 'accept 是 image/*（手机上会给出「拍照 / 相册」）');
    ok(!doc.querySelector('#imgf').hasAttribute('capture'), '没写死 capture —— 否则就只能拍、不能从相册选');
    ok(!!doc.querySelector('#pendimg'), '有待发送图片的预览位（拍糊了能撤掉重拍）');
    ok(doc.querySelector('#imgf').closest('#inbar') !== null, '文件框在输入区里');

    log('');
    log('=== 2. packContent：该发字符串的别发数组 ===');
    {
      const f = t => ev('JSON.stringify(packContent(' + JSON.stringify(t) + '))');
      const plain = f('这题怎么做');
      ok(plain === JSON.stringify('这题怎么做'), '不带图 → 还是字符串（纯文本模型收到数组会报错）');
      ok(ev('packContent("", "")') === '', '空文本空图 → 空串，不是 undefined');

      const withImg = JSON.parse(ev('JSON.stringify(packContent("这题怎么做",' + JSON.stringify(IMG) + '))'));
      ok(Array.isArray(withImg), '带图 → 数组（多模态格式）');
      ok(withImg.length === 2 && withImg[0].type === 'text' && withImg[1].type === 'image_url',
        '结构是 [{text},{image_url}]');
      ok(withImg[1].image_url && withImg[1].image_url.url === IMG, 'image_url.url 就是那张图');

      const noText = JSON.parse(ev('JSON.stringify(packContent("",' + JSON.stringify(IMG) + '))'));
      ok(noText[0].text && noText[0].text.length > 0, '有图没写字时补一句说明（text 不能是空串）：' + JSON.stringify(noText[0].text));
      ok(/题/.test(noText[0].text), '补的那句话提到了「题」，让导师知道要看图');
    }

    log('');
    log('=== 3. shrinkImg：压到最长边 1200、转 JPEG ===');
    {
      /* 3000×2000 的大图 */
      const p = wnd.shrinkImg({ name: 'a.jpg', type: 'image/jpeg' });
      await wait(60);
      const got = await p;
      ok(typeof got === 'string' && got.indexOf('data:image/jpeg') === 0, '导出的是 dataURL：' + String(got).slice(0, 30));
      const ex = wnd.__exports[0];
      ok(ex && ex.w === 1200 && ex.h === 800, '3000×2000 等比缩到 1200×800（实际 ' + (ex ? ex.w + '×' + ex.h : '—') + '）');
      ok(ex && ex.type === 'image/jpeg', '导出为 image/jpeg');
      ok(ex && ex.q > 0.5 && ex.q < 0.9, 'JPEG 质量取在 0.5–0.9 之间（实际 ' + (ex ? ex.q : '—') + '）');
      const painted = wnd.__paint.some(x => x[0] === 'rect');
      ok(painted, '先铺了一层白底（手机截屏带透明区，转 JPEG 会变黑块）');
      const drew = wnd.__paint.some(x => x[0] === 'img');
      ok(drew, '把原图画进画布');
    }
    {
      /* 小图不该被放大 */
      const { wnd: w2 } = boot({ w: 800, h: 600 });
      await wait(700);
      const got = await w2.shrinkImg({ name: 'b.jpg', type: 'image/jpeg' });
      const ex = w2.__exports[0];
      ok(ex && ex.w === 800 && ex.h === 600, '小图原样保留，不放大（实际 ' + (ex ? ex.w + '×' + ex.h : '—') + '）');
      ok(String(got).indexOf('data:image/jpeg') === 0, '同样转成 JPEG');
    }
    {
      /* 竖着拍的题（手机常态）：最长边是高度 */
      const { wnd: w3 } = boot({ w: 900, h: 4000 });
      await wait(700);
      await w3.shrinkImg({ name: 'c.jpg', type: 'image/jpeg' });
      const ex = w3.__exports[0];
      ok(ex && ex.h === 1200 && ex.w === 270, '竖图按高度缩到 1200（实际 ' + (ex ? ex.w + '×' + ex.h : '—') + '）');
    }

    log('');
    log('=== 4. 源码里的压缩上限 ===');
    ok(/IMG_MAX\s*=\s*1200/.test(SRC()), '最长边上限 1200');
    ok(/IMG_Q\s*=\s*0\.7\d/.test(SRC()), 'JPEG 质量约 0.7');

    log('');
    log('--- 异常 ---');
    if (errs.length) { errs.forEach(e => log('  ' + e)); errors.push(...errs); }
    else log('  无');
  }

  /* ================= B. 发送与渲染（带联网替身） ================= */
  {
    const { wnd, errs } = boot({ net: true });
    const doc = wnd.document;
    await wait(700);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const $ = s => doc.querySelector(s);

    ev('CFG=null; $("base").value="https://api.test/v1"; $("key").value="sk-x"; $("model").value="m";');
    ev('CH=[{id:"c.md#1",file:"c.md",title:"行列式",txt:"x"}];COURSE="c.md";LS.s("course",COURSE);MS=[];saveMs();');
    await wait(30);

    log('');
    log('=== 5. 有图没写字也能发，发完清干净 ===');
    {
      const before = ev('MS.length');
      ev('PEND=' + JSON.stringify(IMG) + ';imgThumb();');
      ok($('#pendimg').style.display === 'flex', '预览位显示出来了');
      ok(!!$('#pendimg img'), '预览里有一张缩略图');
      ok($('#pendimg button') !== null, '缩略图旁边有撤掉它的按钮');

      $('#in').value = '';
      $('#send').click();
      await wait(120);

      ok(ev('MS.length') === before + 2, '空文字 + 一张图：发出去了（多了一条提问和一条回答，实际 +' + (ev('MS.length') - before) + '）');
      ok(ev('MS[0].img') === IMG, '图存在这条消息上 MS[0].img');
      ok(ev('MS[0].r') === 'user', '存的是用户那条');
      ok(ev('!!MS[0].s'), '仍然带着节 id（切节/备份都要靠它）');
      ok(ev('PEND') === null, '发完 PEND 清空（不会跟着下一条又发一次）');
      ok($('#in').value === '', '输入框清空');
      ok($('#pendimg').style.display === 'none', '预览位收起来');
    }

    log('');
    log('=== 6. 真正发出去的请求体：带图那条是多模态数组 ===');
    {
      const sent = wnd.__sent;
      ok(sent && Array.isArray(sent.messages), '抓到了请求体');
      const last = sent.messages[sent.messages.length - 1];
      ok(last.role === 'user', '最后一条是用户的提问');
      ok(Array.isArray(last.content), '带图 → content 是数组');
      ok(last.content[1] && last.content[1].image_url && last.content[1].image_url.url === IMG, '数组里带着这张图');
      /* 历史里那条不带图的消息必须还是字符串 */
      const sys = sent.messages[0];
      ok(typeof sys.content === 'string', 'system 还是字符串');
    }

    log('');
    log('=== 7. 对话里能看见题，点开能放大 ===');
    {
      ev('reloadMsgs()');
      await wait(40);
      const im = $('#mw .qimg img');
      ok(!!im, '消息里渲染出了题目图');
      ok(im && im.getAttribute('src') === IMG, 'src 就是那张图');
      ok(im && im.getAttribute('alt'), '有 alt 文字（图片没加载出来时也知道这里是什么）');

      im.click();
      await wait(20);
      const z = $('#zoom');
      ok(!!z, '点一下弹出大图');
      ok(z && z.querySelector('img'), '大图里有图');
      z.click();
      await wait(20);
      ok(!$('#zoom'), '再点一下关掉');
    }

    log('');
    log('=== 8. 无图无文字：点发送不该发出任何东西 ===');
    {
      const before = ev('MS.length');
      $('#in').value = '   ';
      ev('PEND=null;imgThumb();');
      $('#send').click();
      await wait(40);
      ok(ev('MS.length') === before, '空手点发送，什么也没发（实际 +' + (ev('MS.length') - before) + '）');
    }

    log('');
    log('=== 9. 编辑重发别把图弄丢 ===');
    {
      ev('reloadMsgs()');
      await wait(30);
      ev('startEdit(0)');
      await wait(20);
      const ta = $('#mw .edta');
      ok(!!ta, '进入了编辑态');
      ta.value = '换个问法';
      const okBtn = Array.from($('#mw .edbar').querySelectorAll('button')).filter(b => b.textContent === '重发')[0];
      ok(!!okBtn, '有「重发」按钮');
      okBtn.click();
      await wait(160);
      ok(ev('MS[0].c') === '换个问法', '文字换成了新的');
      ok(ev('MS[0].img') === IMG, '图片还在（改个错别字不用重新拍）');
    }

    log('');
    log('--- 异常 ---');
    if (errs.length) { errs.forEach(e => log('  ' + e)); errors.push(...errs); }
    else log('  无');
  }

  log('');
  log('--- 汇总 ---');
  log(errors.length ? ('失败 ' + errors.length + ' 条') : '全部通过');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
