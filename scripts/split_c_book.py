# -*- coding: utf-8 -*-
r"""把《C语言程序设计：现代方法（第2版）》单文件切成 book/C语言/ 下的分册。

思路与 book/ 下的高数、线代分册保持一致：一章一个 .md，文件首行是 `# 第N章 …`，
让站点的 parseFile() 按 `#`/`##` 切出小节。附录 A–F 与「延伸阅读」合并为一个 附录.md。

只做机械切分，不改写正文；唯一例外是把 MinerU 丢失代码围栏后留下的
`#     define     N` 这类伪标题行转义成 `\#`，否则它会被误当成一节。
"""
import os
import re
import sys

# 原书路径与输出目录都从命令行给，别把作者本机的路径写死在仓库里：
#   python scripts/split_c_book.py 原书.md book/C语言
SRC = sys.argv[1] if len(sys.argv) > 1 else "原书.md"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join("book", "C语言")

PROV = ("> 摘自《C语言程序设计：现代方法（第2版）》（[美] K. N. 金 著，吕秀锋、黄倩 译，"
        "人民邮电出版社 2021）\n> 分册版：只含本章内容，用于降低单轮上下文体积。")

# 会被误认成标题的裸代码行（MinerU 丢围栏所致）
FAKE = re.compile(r"^#{1,2}\s+(include|define|ifdef|ifndef|endif|pragma|undef|else|elif|error|line)\b")
CHAP = re.compile(r"^第\d+章")


def safe(name):
    """去掉 Windows 非法文件名字符。"""
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def split():
    lines = open(SRC, encoding="utf-8", errors="replace").read().split("\n")

    fence = False
    marks = []                      # [(行下标, 标题)]
    for i, l in enumerate(lines):
        if l.lstrip().startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        m = re.match(r"^#\s+(.+?)\s*$", l)
        if not m:
            continue
        t = m.group(1)
        if FAKE.match(l):
            continue
        marks.append((i, t))

    chap = [(i, t) for i, t in marks if CHAP.match(t)]
    tail = [(i, t) for i, t in marks if t.startswith("附录") or t == "延伸阅读"]
    return lines, chap, tail


def body_of(lines, pairs, k, stop):
    ln = pairs[k][0]
    end = pairs[k + 1][0] if k + 1 < len(pairs) else stop
    return lines[ln + 1:end]


def neutralize(text):
    """把裸代码伪标题行转义，避免在站点里被切成假小节。"""
    return "\n".join("\\" + l if FAKE.match(l) else l for l in text.split("\n"))


def main():
    lines, chap, tail = split()
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))

    total = 0
    for k, (_, t) in enumerate(chap):
        stop = chap[k + 1][0] if k + 1 < len(chap) else (tail[0][0] if tail else len(lines))
        body = neutralize("\n".join(lines[chap[k][0] + 1:stop]).strip("\n"))
        txt = "# %s\n\n%s\n\n%s\n" % (t, PROV, body)
        open(os.path.join(OUT, safe(t) + ".md"), "w", encoding="utf-8").write(txt)
        total += len(txt)

    if tail:                       # 附录 A–F + 延伸阅读，合并成一个
        parts = []
        for k, (ln, t) in enumerate(tail):
            end = tail[k + 1][0] if k + 1 < len(tail) else len(lines)
            parts.append("\n".join(lines[ln:end]).strip("\n"))
        txt = "# 附录\n\n%s\n\n%s\n" % (PROV, neutralize("\n\n".join(parts)))
        # 不能直接叫「附录.md」：高数包里也有一个同名分册，而 packOf() 是按文件名归属的，
        # 重名会让这本附录被判给高数那门课。
        open(os.path.join(OUT, "附录 A-F.md"), "w", encoding="utf-8").write(txt)
        total += len(txt)

    files = sorted(os.listdir(OUT))
    print("写出 %d 个分册，共 %d 字符" % (len(files), total))
    for f in files:
        print("   ", f, os.path.getsize(os.path.join(OUT, f)))


if __name__ == "__main__":
    main()
