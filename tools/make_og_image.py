#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
アニノベル OGP画像の生成  tools/make_og_image.py
======================================================================
X・Facebook・LINE・Discord・Slack はいずれも SVG の og:image を
描画しない。以前は og-image.svg を指していたため、リンクを共有しても
カード画像が一切出ていなかった。ここで PNG を作る。

  python3 tools/make_og_image.py

出力: og-image.png (1200x630)

構図の方針
----------
LINE などは中央を正方形に切り抜くことがある。左右に振り分けると
切り抜きで文字が落ちるので、吹き出しを上・ロゴを下に置いた縦積みに
している。中央 630x630 を切り抜いても、吹き出しとロゴの両方が残る。

吹き出しの中の台詞は『吾輩は猫である』(夏目漱石) の冒頭。
著作権が切れており、実際にサイトで公開している作品でもある。
他人の文章を宣伝素材に流用しないため、ここは変えないこと。
"""

import os
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630

SERIF_B = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"
SERIF_R = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc"
SANS_R  = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
SANS_B  = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
JP = 0  # .ttc の中で JP 字形が入っている面

INK    = (45, 42, 38)
CREAM  = (250, 246, 240)
ACCENT = (192, 57, 43)
GOLD   = (201, 162, 39)


def font(path, size):
    return ImageFont.truetype(path, size, index=JP)


def background(im):
    """左上 #2d2a26 → 右下 #6b4423 の斜めグラデーション。"""
    c0, c1, c2 = (0x2d, 0x2a, 0x26), (0x4a, 0x37, 0x28), (0x6b, 0x44, 0x23)
    px = im.load()
    for y in range(H):
        for x in range(0, W, 4):
            t = (x / W + y / H) / 2.0
            if t < 0.5:
                u = t / 0.5
                a, b = c0, c1
            else:
                u = (t - 0.5) / 0.5
                a, b = c1, c2
            col = (int(a[0] + (b[0] - a[0]) * u),
                   int(a[1] + (b[1] - a[1]) * u),
                   int(a[2] + (b[2] - a[2]) * u))
            for dx in range(4):
                if x + dx < W:
                    px[x + dx, y] = col


def lattice(im):
    """ごく薄い菱形の地紋。元の SVG の模様を踏襲する。"""
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    s = 60
    for gy in range(-1, H // s + 2):
        for gx in range(-1, W // s + 2):
            cx, cy = gx * s + s / 2, gy * s + s / 2
            d.polygon([(cx, cy - s / 2), (cx + s / 2, cy),
                       (cx, cy + s / 2), (cx - s / 2, cy)],
                      outline=(255, 255, 255, 16))
    im.alpha_composite(ov)


def bubble(d, box, radius, fill, tail="left", tail_at=0.26, tail_size=26):
    """角丸の吹き出し。tail は下辺から出る三角形の向き。"""
    x0, y0, x1, y1 = box
    d.rounded_rectangle(box, radius=radius, fill=fill)
    tx = x0 + (x1 - x0) * tail_at
    if tail == "left":
        pts = [(tx, y1 - 2), (tx + tail_size, y1 - 2), (tx - 4, y1 + tail_size)]
    else:
        pts = [(tx, y1 - 2), (tx - tail_size, y1 - 2), (tx + 4, y1 + tail_size)]
    d.polygon(pts, fill=fill)


def text_w(d, s, f):
    return d.textbbox((0, 0), s, font=f)[2]


def main():
    im = Image.new("RGBA", (W, H), (0, 0, 0, 255))
    background(im)
    lattice(im)
    d = ImageDraw.Draw(im)

    # ---- 吹き出し二つ。段差をつけて会話に見せる ----
    # 名札は出さない。『吾輩は猫である』のこの2行はどちらも同じ語り手で、
    # 別人の名前を添えると嘘になる。吹き出しの形だけで用は足りる。
    f_line = font(SERIF_R, 34)

    s1 = "吾輩は猫である。"
    b1 = (116, 104, 116 + text_w(d, s1, f_line) + 76, 104 + 82)
    bubble(d, b1, 24, CREAM, tail="left", tail_at=0.20)
    d.text((b1[0] + 38, b1[1] + 22), s1, font=f_line, fill=INK)

    s2 = "名前はまだ無い。"
    w2 = text_w(d, s2, f_line) + 76
    b2 = (W - 116 - w2, 226, W - 116, 226 + 82)
    bubble(d, b2, 24, (244, 232, 203), tail="right", tail_at=0.80)
    d.text((b2[0] + 38, b2[1] + 22), s2, font=f_line, fill=INK)

    # ---- ロゴと説明。測ってから積む ----
    cx = W // 2

    f_logo = font(SERIF_B, 88)
    logo = "アニノベル"
    d.text((cx, 382), logo, font=f_logo, fill=CREAM, anchor="mt")
    logo_bottom = d.textbbox((cx, 382), logo, font=f_logo, anchor="mt")[3]

    y = logo_bottom + 24
    d.rectangle((cx - 68, y, cx + 68, y + 3), fill=ACCENT)

    y += 26
    f_tag = font(SANS_R, 28)
    tag = "アニメ風の吹き出しと読み上げで読む、オリジナル小説"
    d.text((cx, y), tag, font=f_tag, fill=(222, 213, 201), anchor="mt")
    y = d.textbbox((cx, y), tag, font=f_tag, anchor="mt")[3]

    f_url = font(SANS_R, 22)
    d.text((cx, y + 14), "aninovel.com", font=f_url, fill=(186, 152, 62), anchor="mt")

    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "og-image.png")
    im.convert("RGB").save(out, "PNG", optimize=True)
    print("書き出しました: %s (%d bytes)" % (out, os.path.getsize(out)))


if __name__ == "__main__":
    main()
