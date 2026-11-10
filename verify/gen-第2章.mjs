/* 生成 verify/第2章 导数与微分.json
 * 每条：expr 是「数值求导」（差分，由 f 得到），want 是正文里写出的闭式结果（由 g 求值）。
 * 两边互相独立，才能真的抓出算错的地方。
 */
import fs from 'node:fs';

const H = 1e-5;
const cases = [];
const add = (o) => cases.push(o);

/* 中心差分一阶导 */
const d1 = (f, h = H) => `((${f.replace(/\bx\b/g, '(x+' + h + ')')})-(${f.replace(/\bx\b/g, '(x-' + h + ')')}))/(2*${h})`;
/* 前向差分（单侧） */
const d1f = (f, h = H) => `((${f.replace(/\bx\b/g, '(x+' + h + ')')})-(${f}))/${h}`;
/* 后向差分（单侧） */
const d1b = (f, h = H) => `((${f})-(${f.replace(/\bx\b/g, '(x-' + h + ')')}))/${h}`;
/* 二阶中心差分 */
const d2 = (f, h = 1e-3) => {
  const up = f.replace(/\bx\b/g, `(x+${h})`), dn = f.replace(/\bx\b/g, `(x-${h})`);
  return `((${up})-2*(${f})+(${dn}))/(${h}*${h})`;
};

const ev = (g, x) => Function('x', 'return ' + g)(x);

const push = (id, desc, expr, g, x, tol) => {
  const want = ev(g, x);
  add({ id, desc, expr, x, want: Number(want.toFixed(12)), tol: tol || 1e-6 });
};

/* ---------- 2.1 变化率 ---------- */
push('2.1-1', '自由落体 s=4.9t^2 在 t=2 的瞬时速度', d1('4.9*x*x'), '9.8*x', 2, 1e-6);
push('2.1-2', 's=t^2+3t 在 t=1 的瞬时速度', d1('x*x+3*x'), '2*x+3', 1);
push('2.1-3', 'y=x^2 在 x=1 的切线斜率', d1('x*x'), '2*x', 1);
push('2.1-4', 'y=1/x 在 x=1 的切线斜率', d1('1/x'), '-1/(x*x)', 1, 1e-6);

/* ---------- 2.2 定义 ---------- */
push('2.2-1', 'f=1/x 在 x=2 的导数', d1('1/x'), '-1/(x*x)', 2, 1e-6);
push('2.2-2', 'f=sqrt(x) 在 x=1 的导数', d1('Math.sqrt(x)'), '1/(2*Math.sqrt(x))', 1, 1e-6);
push('2.2-3', 'f=x^2+1 在 x=3 的导数', d1('x*x+1'), '2*x', 3, 1e-6);
push('2.2-4', '|x| 在 0 的右导数', d1f('Math.abs(x)'), '1', 0, 1e-6);
push('2.2-5', '|x| 在 0 的左导数', d1b('Math.abs(x)'), '-1', 0, 1e-6);

/* ---------- 2.3 可导与连续 ---------- */
push('2.3-1', 'x^(2/3) 在 x=0.001 的导数', d1('Math.pow(x,2/3)'), '(2/3)*Math.pow(x,-1/3)', 0.001, 1e-4);
push('2.3-2', 'cbrt(x) 在 x=0.001 的导数', d1('Math.cbrt(x)'), '1/(3*Math.cbrt(x*x))', 0.001, 1e-4);
push('2.3-3', 'x^2 sin(1/x) 在 x=0.01 的导数（=2x sin(1/x) - cos(1/x)）',
  d1('x*x*Math.sin(1/x)', 1e-6), '2*x*Math.sin(1/x)-Math.cos(1/x)', 0.01, 1e-4);

/* ---------- 2.4 切线与导函数 ---------- */
push('2.4-1', 'y=x^3 在 x=1 的切线斜率', d1('x*x*x'), '3*x*x', 1, 1e-5);
push('2.4-2', 'y=1/x 的导函数在 x=2', d1('1/x'), '-1/(x*x)', 2, 1e-6);
push('2.4-3', 'y=x^3 在 x=3 的导数', d1('x*x*x'), '3*x*x', 3, 1e-5);

/* ---------- 2.5 乘积 ---------- */
push('2.5-1', '(x^2+3x)sin x 在 x=1 的导数', d1('(x*x+3*x)*Math.sin(x)'),
  '(2*x+3)*Math.sin(x)+(x*x+3*x)*Math.cos(x)', 1, 1e-6);
push('2.5-2', 'x e^x sin x 在 x=1 的导数', d1('x*Math.exp(x)*Math.sin(x)'),
  'Math.exp(x)*(Math.sin(x)+x*Math.sin(x)+x*Math.cos(x))', 1, 1e-6);
push('2.5-3', '(x-1)(x-2)(x-3) 在 x=2 的导数', d1('(x-1)*(x-2)*(x-3)'), '-1', 2, 1e-6);
push('2.5-4', '(2x^2-1)(x^2+3) 在 x=1.5 的导数', d1('(2*x*x-1)*(x*x+3)'),
  '8*Math.pow(x,3)+10*x', 1.5, 1e-6);

/* ---------- 2.6 商与反函数 ---------- */
push('2.6-1', '(x^2+1)/(x-1) 在 x=2 的导数', d1('(x*x+1)/(x-1)'), '(x*x-2*x-1)/((x-1)*(x-1))', 2, 1e-6);
push('2.6-2', 'x/(x^2+1) 在 x=1 的导数', d1('x/(x*x+1)'), '(1-x*x)/((x*x+1)*(x*x+1))', 1, 1e-6);
push('2.6-3', 'tan x 在 x=1 的导数', d1('Math.tan(x)'), '1/(Math.cos(x)*Math.cos(x))', 1, 1e-6);
push('2.6-4', 'f=x^3+2x 的反函数在 y=3 处的导数（应为 1/5）',
  d1('(function(v){let u=1;for(let i=0;i<80;i++){u=u-(u*u*u+2*u-v)/(3*u*u+2);}return u;})(x)', 1e-5),
  '1/5', 3, 1e-5);

/* ---------- 2.7 链式 ---------- */
push('2.7-1', 'sin 2x 在 x=1 的导数', d1('Math.sin(2*x)'), '2*Math.cos(2*x)', 1, 1e-6);
push('2.7-2', 'e^(x^2) 在 x=1 的导数', d1('Math.exp(x*x)'), '2*x*Math.exp(x*x)', 1, 1e-6);
push('2.7-3', 'ln cos x 在 x=1 的导数', d1('Math.log(Math.cos(x) )'.replace(' )',')')), '-Math.tan(x)', 1, 1e-6);
push('2.7-4', 'sin^2 3x 在 x=0.3 的导数', d1('Math.pow(Math.sin(3*x),2)'), '3*Math.sin(6*x)', 0.3, 1e-5);
push('2.7-5', 'sqrt(1+x^2) 在 x=1 的导数', d1('Math.sqrt(1+x*x)'), 'x/Math.sqrt(1+x*x)', 1, 1e-6);

/* ---------- 2.8 幂与三角 ---------- */
push('2.8-1', 'x^3 sqrt(x) 在 x=2 的导数', d1('Math.pow(x,3)*Math.sqrt(x)'), '3.5*Math.pow(x,2.5)', 2, 1e-6);
push('2.8-2', 'cot x 在 x=1 的导数', d1('Math.cos(x)/Math.sin(x)'), '-1/(Math.sin(x)*Math.sin(x))', 1, 1e-6);
push('2.8-3', 'sec x 在 x=1 的导数', d1('1/Math.cos(x)'),
  '(1/Math.cos(x))*(Math.sin(x)/Math.cos(x))', 1, 1e-6);
push('2.8-4', '2x^3-5x^2+7x-11 在 x=1.5 的导数', d1('2*Math.pow(x,3)-5*x*x+7*x-11'),
  '6*x*x-10*x+7', 1.5, 1e-6);
push('2.8-5', 'sin x / x 在 x=0.5 的导数', d1('Math.sin(x)/x'),
  '(x*Math.cos(x)-Math.sin(x))/(x*x)', 0.5, 1e-6);

/* ---------- 2.9 指数对数反三角 ---------- */
push('2.9-1', '2^x 在 x=1 的导数', d1('Math.pow(2,x)'), 'Math.pow(2,x)*Math.LN2', 1, 1e-6);
push('2.9-2', 'log2 x 在 x=3 的导数', d1('Math.log2(x)'), '1/(x*Math.LN2)', 3, 1e-6);
push('2.9-3', 'arcsin x 在 x=0.5 的导数', d1('Math.asin(x)'), '1/Math.sqrt(1-x*x)', 0.5, 1e-6);
push('2.9-4', 'arccos x 在 x=0.5 的导数', d1('Math.acos(x)'), '-1/Math.sqrt(1-x*x)', 0.5, 1e-6);
push('2.9-5', 'arctan x 在 x=1 的导数', d1('Math.atan(x)'), '1/(1+x*x)', 1, 1e-6);
push('2.9-6', 'arctan((1+x)/(1-x)) 在 x=0.5 的导数（应等于 1/(1+x^2)）',
  d1('Math.atan((1+x)/(1-x))'), '1/(1+x*x)', 0.5, 1e-6);
push('2.9-7', 'e^(-x^2) 在 x=1 的导数', d1('Math.exp(-x*x)'), '-2*x*Math.exp(-x*x)', 1, 1e-6);
push('2.9-8', 'ln(x+sqrt(1+x^2)) 在 x=1 的导数（应为 1/sqrt(1+x^2)）',
  d1('Math.log(x+Math.sqrt(1+x*x))'), '1/Math.sqrt(1+x*x)', 1, 1e-6);

/* ---------- 2.10 高阶 ---------- */
push('2.10-1', '1/(1+x) 在 x=1 的二阶导数', d2('1/(1+x)'), '2/Math.pow(1+x,3)', 1, 1e-4);
push('2.10-2', 'ln(1+x) 在 x=1 的二阶导数', d2('Math.log(1+x)'), '-1/((1+x)*(1+x))', 1, 1e-4);
push('2.10-3', 'sin x 在 x=0.5 的二阶导数', d2('Math.sin(x)'), '-Math.sin(x)', 0.5, 1e-4);
push('2.10-4', 'e^(2x) 在 x=0.5 的二阶导数（闭式 4e^(2x)）', d2('Math.exp(2*x)'), '4*Math.exp(2*x)', 0.5, 1e-3);
/* 三阶中心差分 (f(x+2h)-2f(x+h)+2f(x-h)-f(x-2h))/(2h^3) */
const d3 = (f, h = 1e-2) => {
  const at = (k) => '(' + f.replace(/\bx\b/g, `(x${k > 0 ? '+' : ''}${k * h})`) + ')';
  return `((${at(2)})-2*(${at(1)})+2*(${at(-1)})-(${at(-2)}))/(2*${h}*${h}*${h})`;
};

push('2.10-5', 'sin x 在 x=0.5 的三阶导数（=-cos 0.5）', d3('Math.sin(x)'), '-Math.cos(x)', 0.5, 1e-3);
push('2.10-6', 'x^2 e^x 在 x=1 的三阶导数（=e^x(x^2+6x+6)）', d3('x*x*Math.exp(x)'),
  'Math.exp(x)*(x*x+6*x+6)', 1, 1e-2);

/* ---------- 2.11 莱布尼茨 ---------- */
push('2.11-1', 'x^2 e^x 在 x=1 的二阶导数（=e^x(x^2+4x+2)）',
  d2('x*x*Math.exp(x)'), 'Math.exp(x)*(x*x+4*x+2)', 1, 1e-3);
push('2.11-2', 'x ln x 在 x=2 的二阶导数（=1/x）', d2('x*Math.log(x)'), '1/x', 2, 1e-4);
push('2.11-4', 'x ln x 在 x=2 的三阶导数（闭式 (-1)^n(n-2)!/x^(n-1)，n=3 得 -1/x^2）',
  d3('x*Math.log(x)'), '-1/(x*x)', 2, 1e-2);
push('2.11-3', 'x e^x 在 x=1 的二阶导数（=e^x(x+2)）', d2('x*Math.exp(x)'),
  'Math.exp(x)*(x+2)', 1, 1e-3);

/* ---------- 2.12 隐函数 ---------- */
push('2.12-1', '圆 x^2+y^2=25 在 (3,4) 的斜率（= -x/y）', d1('Math.sqrt(25-x*x)'), '-x/Math.sqrt(25-x*x)', 3, 1e-6);
push('2.12-2', 'e^y+xy=e 在 (0,1) 的斜率（= -y/(e^y+x)）',
  d1('(function(v){let y=1;for(let i=0;i<80;i++){y=y-(Math.exp(y)+v*y-Math.E)/(Math.exp(y)+v);}return y;})(x)'),
  '-1/Math.E', 0, 1e-5);
push('2.12-3', 'y=cos(x+y) 在 x=0 处的斜率（y≈0.7391，= -sin(x+y)/(1+sin(x+y)) ≈ -0.4025）',
  d1('(function(v){let y=0;for(let i=0;i<80;i++){y=y-(y-Math.cos(v+y))/(1+Math.sin(v+y));}return y;})(x)'),
  '-Math.sin(0.7390851332151607)/(1+Math.sin(0.7390851332151607))', 0, 1e-4);

/* ---------- 2.13 参数方程 ---------- */
push('2.13-1', 'x=t^2,y=t^3 在 t=2 的 dy/dx（=3t/2=3）',
  '((Math.pow(2+1e-5,3)-Math.pow(2-1e-5,3)))/((Math.pow(2+1e-5,2)-Math.pow(2-1e-5,2)))',
  '1.5*2', 0, 1e-6);
push('2.13-2', '摆线 a=1 在 t=pi/2 的 dy/dx（=cot(t/2)=1）',
  '((1-Math.cos(Math.PI/2+1e-5))-(1-Math.cos(Math.PI/2-1e-5)))/(((Math.PI/2+1e-5)-Math.sin(Math.PI/2+1e-5))-((Math.PI/2-1e-5)-Math.sin(Math.PI/2-1e-5)))',
  '1/Math.tan(Math.PI/4)', 0, 1e-5);
push('2.13-3', '椭圆 x=2cos t,y=3sin t 在 t=pi/4 的斜率（= -3/2）',
  '((3*Math.sin(Math.PI/4+1e-5))-(3*Math.sin(Math.PI/4-1e-5)))/((2*Math.cos(Math.PI/4+1e-5))-(2*Math.cos(Math.PI/4-1e-5)))',
  '-1.5', 0, 1e-5);
push('2.13-4', 'x=t^2,y=t^3 在 t=2 的二阶导数（=3/(4t)=0.375）',
  '((1.5*(2+1e-3)-1.5*(2-1e-3))/((Math.pow(2+1e-3,2)-Math.pow(2-1e-3,2))))',
  '3/(4*2)', 0, 1e-5);

/* ---------- 2.14 对数求导 ---------- */
push('2.14-1', 'x^x 在 x=2 的导数（=x^x(ln x+1)）', d1('Math.pow(x,x)'),
  'Math.pow(x,x)*(Math.log(x)+1)', 2, 1e-6);
push('2.14-2', 'x^(sin x) 在 x=2 的导数', d1('Math.pow(x,Math.sin(x))'),
  'Math.pow(x,Math.sin(x))*(Math.cos(x)*Math.log(x)+Math.sin(x)/x)', 2, 1e-6);
push('2.14-3', '(x+1)^2(x-1)/sqrt(x+3) 在 x=2 的导数',
  d1('Math.pow(x+1,2)*(x-1)/Math.sqrt(x+3)'),
  'Math.pow(x+1,2)*(x-1)/Math.sqrt(x+3)*(2/(x+1)+1/(x-1)-1/(2*(x+3)))', 2, 1e-6);
push('2.14-4', 'x^(1/x) 在 x=2 的导数', d1('Math.pow(x,1/x)'),
  'Math.pow(x,1/x)*(1-Math.log(x))/(x*x)', 2, 1e-6);

/* ---------- 2.15 微分 ---------- */
push('2.15-1', 'y=x^2 在 x=2 处 Δx=0.01 的增量 0.0401', 'Math.pow(x+0.01,2)-x*x', '0.0401', 2, 1e-9);
push('2.15-2', '同一情形的微分 dy=4*0.01=0.04', '2*x*0.01', '0.04', 2, 1e-9);
push('2.15-3', 'y=x^3 在 x=1 处 Δx=0.02 的增量 0.061208', 'Math.pow(x+0.02,3)-Math.pow(x,3)', '0.061208', 1, 1e-9);
push('2.15-4', '同一情形的微分 0.06', '3*x*x*0.02', '0.06', 1, 1e-9);

/* ---------- 2.16 近似与误差 ---------- */
push('2.16-1', 'sqrt(1.02) 的一次近似为 1.01（真值 1.00995）', 'Math.sqrt(1.02)', '1.01', 0, 1e-4);
push('2.16-2', 'cbrt(1.02) 的一次近似为 1.006667（真值 1.006623）', 'Math.cbrt(1.02)', '1+0.02/3', 0, 1e-4);
push('2.16-3', 'sin0.02 的一次近似为 0.02（真值 0.0199987）', 'Math.sin(0.02)', '0.02', 0, 1e-4);
push('2.16-4', 'ln1.01 的一次近似为 0.01（真值 0.00995）', 'Math.log(1.01)', '0.01', 0, 1e-2);
push('2.16-5', 'e^0.01 的一次近似为 1.01（真值 1.01005）', 'Math.exp(0.01)', '1.01', 0, 1e-4);
push('2.16-6', 'arctan1.02 的一次近似为 0.7953982（真值 0.7952905）',
  'Math.atan(1.02)', 'Math.PI/4+0.01', 0, 1e-3);
push('2.16-7', '圆柱体积相对误差 2*0.5%+0.2%=1.2%', '2*(0.01/2)+(0.01/5)', '0.012', 0, 1e-9);
push('2.16-8', '正方体棱长 0.5% 误差使体积相对误差 1.5%', '3*(0.05/10)', '0.015', 0, 1e-9);

/* ---------- 综合自测 ---------- */
push('A-1', 'x/sqrt(1+x^2) 在 x=2 的导数（=1/(1+x^2)^{3/2}）',
  d1('x/Math.sqrt(1+x*x)'), '1/Math.pow(1+x*x,1.5)', 2, 1e-6);
push('A-2', 'x^2+xy+y^2=3 在 (1,1) 的斜率（= -(2x+y)/(x+2y) = -1）',
  d1('(function(v){let y=1;for(let i=0;i<80;i++){y=y-(v*v+v*y+y*y-3)/(v+2*y);}return y;})(x)'),
  '-1', 1, 1e-4);
push('A-3', '(sin x)^x 在 x=1 的导数', d1('Math.pow(Math.sin(x),x)'),
  'Math.pow(Math.sin(x),x)*(Math.log(Math.sin(x))+x/Math.tan(x))', 1, 1e-6);

fs.writeFileSync('verify/第2章 导数与微分.json',
  JSON.stringify(cases, null, 2) + '\n', 'utf8');
console.log('写出', cases.length, '条');
