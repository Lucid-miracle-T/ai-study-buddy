/**
 * 讲义校验：把「质量」变成能跑的东西。
 *
 * 用法：
 *   node verify/run.mjs            # 全量校验
 *   node verify/run.mjs 第1章       # 只校验某一章
 *
 * 五类检查（对应 docs/讲义体例.md 第五、八节）：
 *   1. KaTeX 真渲染，一个 ParseError 都不许有
 *   2. 禁令词：显然 / 易证 / 同理可得 / 如图可见 / 前面讲过
 *   3. 每节七段齐全、顺序不乱
 *   4. 知识点覆盖：清单里的关键词必须出现在正文
 *   5. 数值例题复算：verify/<章>.json 里每条都重算一遍
 *
 * 退出码：0 全绿；1 有失败项。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* KaTeX 装在工具链目录里（站内不放 node_modules）。ESM 不认 NODE_PATH，
   所以用 createRequire 从那个目录解析；也可用 KATEX_DIR 覆盖。 */
const KATEX_DIR = process.env.KATEX_DIR
  || 'C:/Users/35343/.workbuddy/binaries/node/workspace/';
const katex = createRequire(KATEX_DIR)('katex');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = path.join(ROOT, 'store', '变化与累积-一元微积分');

let bad = 0;
const log = (s) => console.log(s);
const ok = (cond, msg, detail) => {
  if (cond) { log('  ✓ ' + msg); }
  else { bad++; log('  ✗ ' + msg + (detail ? '\n      → ' + detail : '')); }
};

/* ---------- 0. 找到要校验的章 ---------- */
const only = process.argv[2] || '';
const chapters = fs.readdirSync(BOOK)
  .filter(f => f.endsWith('.md') && !f.startsWith('_'))
  .filter(f => !only || f.includes(only))
  .sort();

if (!chapters.length) { log('没找到章节文件'); process.exit(1); }

/* ---------- 每个学习单元必须的五段（11-10 起由「七段」改为「五段」） ---------- */
const SEGS = [
  ['为什么需要它', /^###\s*为什么需要它/m],
  ['定义与结论', /^###\s*定义与结论/m],
  ['例题', /^###\s*例题/m],
  ['出错点', /^###\s*出错点/m],
  ['自测', /^###\s*自测/m],
];

/* ---------- 禁令词 ---------- */
const BANNED = [
  ['显然', /显然/],
  ['易证', /易证/],
  ['同理可得', /同理可得/],
  ['如图可见', /如图可见/],
  ['前面讲过（不指出具体位置）', /前面讲过(?!\s*§)/],
];

/* ---------- 知识点覆盖：每个单元必须出现的关键词（键 = 单元号） ---------- */
const COVER = {
  '1.1': ['映射', '单射', '满射', '双射', '逆映射', '定义域', '值域', '复合'],
  '1.2': ['禁区', '有界', '单调', '奇偶', '周期', '反函数', '复合函数'],
  '1.3': ['幂函数', '指数函数', '对数函数', '三角函数', '反三角', '初等函数', '图形变换', '双曲'],
  '1.4': ['varepsilon', '正整数', '唯一', '有界', '保号', '子列', '收敛', '发散'],
  '1.5': ['放大', '误差', '否定', 'N'],
  '1.6': ['delta', '去心', '海涅', '无穷'],
  '1.7': ['左极限', '右极限', '分段'],
  '1.8': ['无穷小', '无穷大', '有界', '振荡'],
  '1.9': ['四则运算', '未定式', '复合函数', '局部有界', '局部保号'],
  '1.10': ['夹逼', '单调有界', '归纳', '上界'],
  '1.11': ['sin', '弧度', '重要极限', '面积'],
  '1.12': ['未定式', '复利', '标准形式', 'e'],
  '1.13': ['高阶', '同阶', '等价', 'o(', '抵消', '阶数', '替换'],
  '1.14': ['连续', '左连续', '右连续', '间断点', '可去', '跳跃', '无穷间断', '振荡'],
  '1.15': ['闭区间', '有界', '最大值', '零点定理', '介值定理', '一致连续'],

  '2.1': ['平均变化率', '瞬时', '切线', '单位', '相关变化率'],
  '2.2': ['导数', '可导', '记法', '单侧导数', '区间可导', '三步'],
  '2.3': ['连续', '尖点', '竖直', '振荡', '可导'],
  '2.4': ['切线', '法线', '导函数', '定义域'],
  '2.5': ['乘积', '和差', '三项', '常数因子'],
  '2.6': ['商法则', '反函数', '倒数', '对应点'],
  '2.7': ['链式', '中间变量', '复合', '多层'],
  '2.8': ['幂函数', '正弦', '余弦', '正切', '常数', '二项式'],
  '2.9': ['指数', '对数', '反正弦', '反余弦', '反正切', '反向认结构'],
  '2.10': ['二阶导数', '阶导数', '归纳法', '加速度', '阶乘'],
  '2.11': ['莱布尼茨', '二项式', '求和', '多项式'],
  '2.12': ['隐函数', '两边对', '二阶', '乘积法则'],
  '2.13': ['参数方程', '参数', '竖直', '二阶导数'],
  '2.14': ['对数求导', '幂指', '取对数', '中间变量'],
  '2.15': ['微分', '线性主部', '形式不变性', '可微', '切线'],
  '2.16': ['近似', '误差限', '相对误差', '绝对误差'],
};

/* ---------- 1. 逐章校验 ---------- */
for (const file of chapters) {
  const full = path.join(BOOK, file);
  const src = fs.readFileSync(full, 'utf8');
  const cjk = (src.match(/[\u4e00-\u9fa5]/g) || []).length;
  const secs = src.split(/^## /m).slice(1).map(s => '## ' + s);
  /* 章号：从文件名「第N章」取，用于匹配单元号、例题号与覆盖清单 */
  const CHNO = (file.match(/第(\d+)章/) || [])[1] || '1';
  const reUnit = new RegExp('^## ' + CHNO + '\\.\\d+\\s');
  const reEx = new RegExp('^\\*\\*例 ' + CHNO + '\\.', 'gm');

  log('');
  log('══ ' + file + ' ══');
  log(`  中文字数 ${cjk}，共 ${secs.length} 个二级小节`);

  /* -- 1.1 KaTeX 渲染 -- */
  log('');
  log('【1】公式渲染');
  const inline = src.match(/\$\$[\s\S]+?\$\$/g) || [];
  const single = (src.replace(/\$\$[\s\S]+?\$\$/g, '') .match(/\$[^$\n]+?\$/g) || []);
  let texBad = 0;
  const texErr = [];
  for (const [arr, display] of [[inline, true], [single, false]]) {
    for (const raw of arr) {
      const body = display ? raw.slice(2, -2) : raw.slice(1, -1);
      try { katex.renderToString(body, { displayMode: display, throwOnError: true }); }
      catch (e) { texBad++; if (texErr.length < 6) texErr.push(body.slice(0, 70) + ' → ' + e.message.slice(0, 90)); }
    }
  }
  ok(texBad === 0, `KaTeX 渲染 ${inline.length + single.length} 个公式，全部通过`,
    texErr.join('\n      '));

  /* -- 1.2 禁令词 -- */
  log('');
  log('【2】写法禁令');
  for (const [name, re] of BANNED) {
    const hits = [...src.matchAll(new RegExp(re.source, 'gm'))]
      .map(m => {
        const line = src.slice(0, m.index).split('\n').length;
        const ctx = src.split('\n')[line - 1] || '';
        return `第 ${line} 行：${ctx.trim().slice(0, 60)}`;
      });
    ok(hits.length === 0, `没有「${name}」`, hits.slice(0, 3).join('\n      '));
  }

  /* -- 1.3 五段齐全 -- */
  log('');
  log('【3】每个单元五段');
  const teaching = secs.filter(s => reUnit.test(s));
  ok(teaching.length > 0, `找到 ${teaching.length} 个学习单元`);
  for (const sec of teaching) {
    const title = sec.split('\n')[0].replace(/^## /, '').slice(0, 24);
    const miss = SEGS.filter(([, re]) => !re.test(sec)).map(([n]) => n);
    ok(miss.length === 0, `${title} 五段齐全`, '缺：' + miss.join('、'));

    /* 单元卡：最上面那段引用里要有时长、前置、读完你能 */
    const head = sec.split('\n').slice(0, 6).join('\n');
    ok(/分钟/.test(head) && /前置/.test(head) && /读完你能/.test(head),
      `　有单元卡（时长 / 前置 / 读完你能）`);

    /* 每单元至少 1 例题、2 错误、2 自测 */
    const exn = (sec.match(reEx) || []).length;
    const errn = (sec.match(/^\*\*错误 \d/gm) || []).length;
    const detn = (sec.match(/<details>/g) || []).length;
    ok(exn >= 1, `　例题 ${exn} 个（≥1）`);
    ok(errn >= 2, `　错误 ${errn} 条（≥2）`);
    ok(detn >= 2, `　自测折叠答案 ${detn} 个（≥2）`);
  }

  /* -- 1.4 知识点覆盖 -- */
  log('');
  log('【4】知识点覆盖');
  for (const [key, words] of Object.entries(COVER)) {
    if (!key.startsWith(CHNO + '.')) continue;
    const sec = teaching.find(s => s.startsWith('## ' + key + ' '));
    if (!sec) { ok(false, `找不到单元「${key}」`); continue; }
    const miss = words.filter(w => !sec.includes(w));
    ok(miss.length === 0, `${key} 覆盖 ${words.length} 个关键词`, '缺：' + miss.join('、'));
  }

  /* -- 1.5 结构完整性 -- */
  log('');
  log('【5】结构完整性');
  const hasToc = /^### 目录/m.test(src) && /^### 三条阅读路线/m.test(src);
  ok(hasToc, '章首有目录表与三条阅读路线');
  const badDet = [...src.matchAll(/<details>(?!<summary>)/g)].length;
  ok(badDet === 0, 'details 都带 summary（否则折叠块没有标题）');
  const unbalanced = (src.match(/<details>/g) || []).length !== (src.match(/<\/details>/g) || []).length;
  ok(!unbalanced, 'details 标签成对');
  ok(/^## 章末/m.test(src), '章末「如果只记三件事」存在');
  /* 一级标题后不能紧跟正文：站点按 ^#{1,2}\s 切节，会把引言切成独立一节 */
  const h1Tail = src.split(/^# /m)[1] || '';
  const nextLine = (h1Tail.split('\n').slice(1).find(l => l.trim()) || '').trim();
  ok(nextLine.startsWith('## '), '一级标题后紧跟二级标题（不把引言切成独立一节）');

  /* -- 1.6 数值复算 -- */
  log('');
  log('【6】数值例题复算');
  const vf = path.join(ROOT, 'verify', file.replace(/\.md$/, '.json'));
  if (!fs.existsSync(vf)) {
    ok(false, '缺少复算用例文件', path.basename(vf));
  } else {
    const cases = JSON.parse(fs.readFileSync(vf, 'utf8'));
    let pass = 0, fail = [];
    for (const c of cases) {
      let got;
      try { got = Number(new Function('x', 'return ' + c.expr)(c.x)); }
      catch (e) { fail.push(`${c.id} 表达式无法求值：${e.message}`); continue; }
      if (!Number.isFinite(got)) { fail.push(`${c.id} 算得非有限值`); continue; }
      /* le 模式：只验「不大于某个界」（用于放大/缩小方向的检查） */
      if (c.le !== undefined) {
        if (got <= c.le) pass++;
        else fail.push(`${c.id} ${c.desc}\n        x=${c.x} 算得 ${got}，应 ≤ ${c.le}`);
        continue;
      }
      const want = c.want;
      const rel = Math.abs(got - want) / Math.max(1, Math.abs(want));
      if (rel > (c.tol || 1e-6)) {
        fail.push(`${c.id} ${c.desc}\n        x=${c.x} 算得 ${got}，期望 ${want}，相对误差 ${rel.toExponential(2)}`);
      } else pass++;
    }
    ok(fail.length === 0, `${cases.length} 条用例全部复算通过（容差 1e-6）`, fail.slice(0, 4).join('\n      '));
  }
}

log('');
log(bad === 0 ? '═══ 全部通过 ═══' : `═══ ${bad} 项未通过 ═══`);
process.exit(bad === 0 ? 0 : 1);
