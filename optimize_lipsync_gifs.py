#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
optimize_lipsync_gifs.py  —  AniNovel
E:\\aninovel\\aninovel\\ で実行してください。

  pip install pillow        # 未インストールなら一度だけ
  python optimize_lipsync_gifs.py

lipsync/ 配下の大きすぎる口パクGIFを、最大256px へ縮小＋減色＋最適化して上書きします。
（アイコンは最大160px程度で表示されるため、256pxあれば十分・高精細ディスプレイにも対応）
Cloudflare Pages の「1ファイル25 MiBまで」を回避し、口パクGIFは維持します。

既定では 20 MiB 超 または 長辺 280px 超 のGIFを対象に縮小します（しきい値は下の定数で調整可）。
元ファイルは ../lipsync_orig_backup/ に退避してから上書きします（リポジトリ外＝デプロイに含まれない）。
"""
import os, sys, shutil

# ---- しきい値（必要なら調整）----
SIZE_THRESHOLD_MB = 20      # この MiB を超えるGIFを対象
MAX_DIM = 256               # 縮小後の長辺(px)
COLORS = 128                # 減色数（256で高品質/64で軽量）
# --------------------------------

ROOT = os.getcwd()
LIPSYNC = os.path.join(ROOT, "lipsync")
BACKUP = os.path.join(os.path.dirname(ROOT), "lipsync_orig_backup")

try:
    from PIL import Image, ImageSequence
except ImportError:
    print("[ERROR] Pillow が必要です。先に:  pip install pillow")
    sys.exit(1)

def optimize_gif(path, max_dim=MAX_DIM, colors=COLORS):
    im = Image.open(path)
    w, h = im.size
    scale = min(1.0, float(max_dim) / float(max(w, h)))
    frames, durations = [], []
    for fr in ImageSequence.Iterator(im):
        f = fr.convert("RGBA")
        if scale < 1.0:
            f = f.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        frames.append(f.convert("P", palette=Image.ADAPTIVE, colors=colors))
        durations.append(fr.info.get("duration", 80))
    loop = im.info.get("loop", 0)
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   loop=loop, duration=durations, disposal=2, optimize=True)
    return (w, h), frames[0].size, len(frames)

def main():
    if not os.path.isdir(LIPSYNC):
        print("[ERROR] lipsync/ が見つかりません。リポジトリのルートで実行してください。")
        sys.exit(1)

    targets = []
    for dp, _d, fs in os.walk(LIPSYNC):
        for fn in fs:
            if not fn.lower().endswith(".gif"):
                continue
            full = os.path.join(dp, fn)
            size_mb = os.path.getsize(full) / (1024 * 1024)
            big_dim = False
            try:
                with Image.open(full) as im:
                    big_dim = max(im.size) > (MAX_DIM + 24)
            except Exception:
                pass
            if size_mb > SIZE_THRESHOLD_MB or big_dim:
                targets.append((full, size_mb))

    if not targets:
        print(f"[OK] {SIZE_THRESHOLD_MB}MiB超 / 長辺{MAX_DIM}px超 のGIFはありません。縮小不要です。")
        return

    os.makedirs(BACKUP, exist_ok=True)
    print(f"対象 {len(targets)} 件を縮小します（最大{MAX_DIM}px / {COLORS}色）。元は {BACKUP} へ退避。\n")
    total_before = total_after = 0.0
    for full, before in sorted(targets, key=lambda x: -x[1]):
        rel = os.path.relpath(full, LIPSYNC)
        bpath = os.path.join(BACKUP, rel)
        os.makedirs(os.path.dirname(bpath), exist_ok=True)
        shutil.copyfile(full, bpath)
        try:
            (ow, oh), (nw, nh), nframes = optimize_gif(full)
        except Exception as e:
            print(f"  [SKIP] {rel}  縮小失敗: {e}")
            continue
        after = os.path.getsize(full) / (1024 * 1024)
        total_before += before; total_after += after
        flag = "  ⚠まだ25MiB超!" if after >= 25 else ""
        print(f"  {rel}\n      {before:.1f}MiB({ow}x{oh}) -> {after:.1f}MiB({nw}x{nh}, {nframes}f){flag}")

    print(f"\n[DONE] 合計 {total_before:.1f}MiB -> {total_after:.1f}MiB")
    still = [t for t, _ in targets if os.path.getsize(t) / (1024*1024) >= 25]
    if still:
        print(f"[WARN] まだ25MiB以上が {len(still)} 件あります。MAX_DIMやCOLORSを下げて再実行してください。")
        for s in still[:10]:
            print("   -", os.path.relpath(s, LIPSYNC))
    print("\n次の手順:")
    print("  git add -A")
    print('  git commit -m "chore(lipsync): 大容量GIFを256pxへ縮小(Pages 25MiB制限対応)"')
    print("  git push origin main")

if __name__ == "__main__":
    main()
