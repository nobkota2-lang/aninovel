#!/usr/bin/env python3
# -*- coding: utf-8 -*-
#
# build-assets.py  —  AniNovel
# オリジナル（E:\MetaAI）から、本番の gallery / lipsync を作り直します。
# ============================================================================
#
# 実行する場所
#   E:\aninovel\aninovel  （gallery\ と data\ がある場所）
#
#   python tools\build-assets.py --dry     ← まず確認だけ。1ファイルも書きません
#   python tools\build-assets.py           ← 実際に作り直す
#
# 何をするか
#   1. E:\MetaAI\Gallery の PNG を 128x128 の JPEG にして gallery\ へ
#   2. E:\MetaAI\Lipsync の GIF を 128x128 に縮めて lipsync\ へ（動きは残す）
#   3. アイコンが無い口パクGIFは入れない（対応が取れるものだけ反映する）
#   4. data\gallery-manifest.json を作り直す
#   5. 新しい一式に入らない古いファイルは gallery\ / lipsync\ から消す
#
# オリジナル（E:\MetaAI）には一切書き込みません。読むだけです。
#
# なぜ GIF は JPEG にしないのか
#   口パクGIFは37コマの動く画像です。JPEGにすると1コマの静止画になり、
#   口パクという機能そのものが消えます。GIFのまま小さくします。
#
# gifsicle について
#   GIFを小さくするには gifsicle が要ります。入っていれば自動で使い、
#   半分ほどまで小さくなります。入っていなければ Pillow だけで縮小します
#   （512→128 の縮小は効くので、入っていなくても大きな効果はあります）。
#   置き場所は PATH、または tools\gifsicle\gifsicle.exe を見ます。
#   入れ方: https://eternallybored.org/misc/gifsicle/ の Windows版を展開し、
#           gifsicle.exe を tools\gifsicle\ に置くだけです。
#
# 道のりの対応（オリジナル → 本番）
#   Gallery\Female\<年代>\<画風>\x.png        → gallery\Female\<年代>\<画風>\x.jpg
#   Gallery\Male\<年代>\<画風>\x.png          → gallery\Male\<年代>\<画風>\x.jpg
#   Gallery\Etc\Animal\<画風>\Bear.png        → gallery\Etc\Animal\<画風>\Bear.jpg
#   Gallery\Etc\Animal\Bear\<画風>\x.png      → gallery\Etc\Animal\Bear\<画風>\x.jpg
#   Lipsync\Etc\Bear\<画風>\x.gif             → lipsync\Etc\Animal\Bear\<画風>\x.gif
#       ↑ 口パク側だけ Animal\ の階層が抜けているので、ここで揃えます。
#         揃えないと viewer が同じ道のりを探しに行けず、口パクが見つかりません。

import argparse, json, os, shutil, subprocess, sys, time

# ---- 設定の既定値（コマンドの引数で変えられます）----------------------------
ICON_PX      = 128     # アイコンの一辺
ICON_QUALITY = 85      # JPEGの品質
GIF_PX       = 128     # 口パクGIFの一辺
GIF_LOSSY    = 100     # gifsicle の --lossy。大きいほど小さく、粗くなる
SRC_DEFAULT  = r"E:\MetaAI"
# ---------------------------------------------------------------------------

RACES = ["Micronesia", "Japanese", "Black", "White", "Arab", "India", "Latin"]
AGES  = ["Baby", "Infant", "ESchool", "MSchool", "20-30s", "40-60s", "70s-"]
TYPES = ["Anime", "Manga", "Photo"]


# ============================ 道のりの読み取り ================================

def icon_target(rel):
    """オリジナルのGallery配下の相対パスを、本番 gallery\ の相対パスに直す。
       読み取れない形のものは None を返して、黙って見送る。"""
    p = rel.replace("\\", "/").split("/")
    if not p or not p[-1].lower().endswith(".png"):
        return None
    stem = p[-1][:-4]
    if p[0] == "Etc":
        if len(p) == 4 and p[1] == "Animal" and p[2] in TYPES:
            return f"Etc/Animal/{p[2]}/{stem}.jpg"
        if len(p) == 5 and p[1] == "Animal" and p[3] in TYPES:
            return f"Etc/Animal/{p[2]}/{p[3]}/{stem}.jpg"
        return None
    if len(p) == 4 and p[0] in ("Female", "Male") and p[1] in AGES and p[2] in TYPES:
        return f"{p[0]}/{p[1]}/{p[2]}/{stem}.jpg"
    return None


def gif_target(rel):
    """オリジナルのLipsync配下の相対パスを、本番 lipsync\ の相対パスに直す。
       動物の派生だけ Animal\ の階層が抜けているので、ここで足す。"""
    p = rel.replace("\\", "/").split("/")
    if not p or not p[-1].lower().endswith(".gif"):
        return None
    stem = p[-1][:-4]
    if p[0] == "Etc":
        if len(p) == 4 and p[1] == "Animal" and p[2] in TYPES:
            return f"Etc/Animal/{p[2]}/{stem}.gif"
        if len(p) == 4 and p[2] in TYPES:          # Etc/Bear/Anime/x.gif
            return f"Etc/Animal/{p[1]}/{p[2]}/{stem}.gif"
        if len(p) == 5 and p[1] == "Animal" and p[3] in TYPES:
            return f"Etc/Animal/{p[2]}/{p[3]}/{stem}.gif"
        return None
    if len(p) == 4 and p[0] in ("Female", "Male") and p[1] in AGES and p[2] in TYPES:
        return f"{p[0]}/{p[1]}/{p[2]}/{stem}.gif"
    return None


# ============================== manifest =====================================

def classify(rel_jpg):
    """gallery\ の相対パスから、manifest の1グループ分の素性を決める。
       現行の data\gallery-manifest.json を完全に再現できることを確認済み。"""
    p = rel_jpg.split("/")
    if p[0] == "Etc":
        if len(p) == 4:                                   # Etc/Animal/<画風>/Bear.jpg
            typ = p[2]
            return ("", "Etc", typ, "Adult", f"Animal / {typ}", f"Etc_Animal_{typ}")
        if len(p) == 5:                                   # Etc/Animal/Bear/<画風>/x.jpg
            animal, typ = p[2], p[3]
            return ("", "Etc", typ, "Adult", f"{animal} / {typ}", f"Etc_{animal}_{typ}")
        return None
    if len(p) == 4:
        gender, age, typ, fn = p
        race = next((r for r in RACES if r in fn), None)
        if not race:
            return None
        return (gender, race, typ, age,
                f"{gender} / {age} / {typ} / {race}", f"{gender}_{race}_{typ}_{age}")
    return None


def build_manifest(rel_jpgs):
    groups, unclassified = {}, []
    for rel in rel_jpgs:
        c = classify(rel)
        if not c:
            unclassified.append(rel); continue
        gender, race, typ, age, label, gid = c
        g = groups.setdefault(gid, {"id": gid, "gender": gender, "race": race,
                                    "type": typ, "age": age, "label": label, "items": []})
        g["items"].append({"p": "gallery/" + rel})
    out = list(groups.values())
    for g in out:
        g["items"].sort(key=lambda it: it["p"])
    out.sort(key=lambda x: (x["gender"], x["age"], x["type"], x["race"], x["id"]))
    return out, unclassified


# ============================== 画像の変換 ====================================

# 何をどの設定で作ったかを控えておく台帳。
# 以前は「出来上がりがオリジナルより新しければ作り直さない」で済ませていたが、
# 既存の口パクGIFは別のスクリプトが作ったもので、オリジナルより新しかったため
# まるごとスキップされ、圧縮されないまま残ってしまった。
# 作った時の設定ごと控えて、設定が変わったら作り直すようにする。
STAMP_NAME = ".assets-build.json"

def load_stamp(root):
    p = os.path.join(root, STAMP_NAME)
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}

def save_stamp(root, stamp):
    try:
        with open(os.path.join(root, STAMP_NAME), "w", encoding="utf-8") as f:
            json.dump(stamp, f, separators=(",", ":"))
    except Exception as e:
        print("  [注意] 台帳を書けませんでした:", e)

def up_to_date(stamp, key, src, dst, sig):
    if not os.path.exists(dst):
        return False
    e = stamp.get(key)
    if not isinstance(e, list) or len(e) != 3:
        return False
    try:
        return e[0] == sig and abs(e[1] - os.path.getmtime(src)) < 1 and e[2] == os.path.getsize(src)
    except OSError:
        return False

def mark(stamp, key, src, sig):
    try:
        stamp[key] = [sig, os.path.getmtime(src), os.path.getsize(src)]
    except OSError:
        pass


def find_gifsicle(root):
    cand = [os.path.join(root, "tools", "gifsicle", "gifsicle.exe"),
            os.path.join(root, "tools", "gifsicle.exe")]
    for c in cand:
        if os.path.isfile(c):
            return c
    return shutil.which("gifsicle")


def convert_icon(src, dst, px, quality):
    from PIL import Image
    im = Image.open(src)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    if max(im.size) != px:
        im = im.resize((px, px), Image.LANCZOS) if im.width == im.height else \
             im.resize((px, round(im.height * px / im.width)), Image.LANCZOS)
    im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)


def convert_gif_gifsicle(exe, src, dst, px, lossy):
    subprocess.run([exe, "--resize-fit", f"{px}x{px}", "--resize-method=mix",
                    "--colors", "256", "-O3", f"--lossy={lossy}", src, "-o", dst],
                   check=True, capture_output=True)


def convert_gif_pillow(src, dst, px):
    from PIL import Image, ImageSequence
    im = Image.open(src)
    frames, durations = [], []
    for fr in ImageSequence.Iterator(im):
        f = fr.convert("RGB")
        if max(f.size) != px:
            f = f.resize((px, px), Image.LANCZOS)
        frames.append(f.convert("P", palette=Image.ADAPTIVE, colors=128))
        durations.append(fr.info.get("duration", 80))
    frames[0].save(dst, save_all=True, append_images=frames[1:],
                   loop=im.info.get("loop", 0), duration=durations,
                   disposal=2, optimize=True)


# ================================ 本体 =======================================

def human(n):
    return f"{n/1048576:.1f}MB" if n >= 1048576 else f"{n/1024:.0f}KB"


def scan(base, mapper):
    """base 配下を歩いて {本番の相対パス: オリジナルの実パス} を作る。
       同じ行き先に複数が当たったら、後勝ちにせず報告する。"""
    found, skipped, clash = {}, [], []
    if not os.path.isdir(base):
        return found, skipped, clash
    for dp, _d, fs in os.walk(base):
        for fn in fs:
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, base)
            tgt = mapper(rel)
            if not tgt:
                skipped.append(rel); continue
            if tgt in found:
                clash.append((tgt, found[tgt], full)); continue
            found[tgt] = full
    return found, skipped, clash


def main():
    ap = argparse.ArgumentParser(description="AniNovel の gallery / lipsync を作り直します")
    ap.add_argument("--dry", action="store_true", help="確認のみ。1ファイルも書きません")
    ap.add_argument("--src", default=SRC_DEFAULT, help=f"オリジナルの場所（既定 {SRC_DEFAULT}）")
    ap.add_argument("--quality", type=int, default=ICON_QUALITY, help=f"JPEGの品質（既定 {ICON_QUALITY}）")
    ap.add_argument("--lossy", type=int, default=GIF_LOSSY, help=f"GIFの粗さ（既定 {GIF_LOSSY}。大きいほど小さく粗い）")
    ap.add_argument("--icon-px", type=int, default=ICON_PX)
    ap.add_argument("--gif-px", type=int, default=GIF_PX)
    ap.add_argument("--no-etc-variants", action="store_true",
                    help="動物の派生（Bear/Anime/... の10種ずつ）を入れない")
    ap.add_argument("--force", action="store_true",
                    help="台帳を無視して全部作り直す（設定を変えずに作り直したいとき）")
    ap.add_argument("--keep-stale", action="store_true", help="新しい一式に入らない古いファイルを消さない")
    args = ap.parse_args()

    root = os.getcwd()
    if not os.path.isdir(os.path.join(root, "gallery")) or not os.path.isdir(os.path.join(root, "data")):
        print("[中止] gallery\\ と data\\ が見つかりません。")
        print("       E:\\aninovel\\aninovel で実行してください。いまの場所:", root)
        sys.exit(1)
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("[中止] Pillow が必要です。先に:  pip install pillow")
        sys.exit(1)

    src_gal = os.path.join(args.src, "Gallery")
    src_lip = os.path.join(args.src, "Lipsync")
    if not os.path.isdir(src_gal):
        print(f"[中止] {src_gal} が見つかりません。--src で場所を指定してください。")
        sys.exit(1)

    gifsicle = find_gifsicle(root)
    print("=" * 70)
    print("確認のみ（何も書きません）" if args.dry else "作り直します")
    print("  オリジナル :", args.src, "（読むだけ。書き換えません）")
    print("  行き先     :", root)
    print(f"  アイコン   : {args.icon_px}px JPEG 品質{args.quality}")
    if gifsicle:
        print(f"  口パクGIF  : {args.gif_px}px  gifsicle --lossy={args.lossy}")
        print("               ", gifsicle)
    else:
        print(f"  口パクGIF  : {args.gif_px}px  Pillow のみ（gifsicle が無いので圧縮は弱め）")
    print("=" * 70)

    # ---- 1. 元を数える ----
    icons, ic_skip, ic_clash = scan(src_gal, icon_target)
    gifs,  gf_skip, gf_clash = scan(src_lip, gif_target)

    if args.no_etc_variants:
        icons = {k: v for k, v in icons.items() if not (k.startswith("Etc/") and k.count("/") == 4)}
        gifs  = {k: v for k, v in gifs.items()  if not (k.startswith("Etc/") and k.count("/") == 4)}

    # 口パクは、対応するアイコンがあるものだけ。無いものは探されないので入れない
    icon_keys = set(icons)
    paired = {k: v for k, v in gifs.items() if k[:-4] + ".jpg" in icon_keys}
    orphan = sorted(set(gifs) - set(paired))

    print(f"アイコン : {len(icons):5d} 件   （読み取れず見送り {len(ic_skip)} 件）")
    print(f"口パクGIF: {len(paired):5d} 件   （対応するアイコンが無く見送り {len(orphan)} 件）")
    if ic_clash or gf_clash:
        print(f"[注意] 行き先が重なるものがありました: アイコン {len(ic_clash)} 件 / GIF {len(gf_clash)} 件")
        for t, a, b in (ic_clash + gf_clash)[:5]:
            print("   ", t, "\n       <-", a, "\n       <-", b)
    cov = round(len(paired) / len(icons) * 100) if icons else 0
    print(f"口パクが付くアイコンの割合: {cov}%  （付かない分は、読むときにその場で作ります）")
    print()

    # ---- 2. いまの本番と比べる ----
    def listing(sub, ext):
        base = os.path.join(root, sub)
        out = {}
        for dp, _d, fs in os.walk(base):
            for fn in fs:
                if fn.lower().endswith(ext):
                    full = os.path.join(dp, fn)
                    out[os.path.relpath(full, base).replace("\\", "/")] = os.path.getsize(full)
        return out

    now_gal = listing("gallery", (".png", ".jpg", ".jpeg", ".webp"))
    now_lip = listing("lipsync", ".gif")
    stale = sorted([k for k in now_gal if k not in icons] )
    stale_lip = sorted([k for k in now_lip if k not in paired])
    print(f"いまの本番 : gallery {len(now_gal)} 件 {human(sum(now_gal.values()))} / "
          f"lipsync {len(now_lip)} 件 {human(sum(now_lip.values()))}")
    print(f"消える物   : gallery {len(stale)} 件 / lipsync {len(stale_lip)} 件"
          + ("（--keep-stale が付いているので消しません）" if args.keep_stale else ""))
    print()

    if args.dry:
        print("--- これから作るものの例（先頭10件）---")
        for k in sorted(icons)[:10]:
            print("   gallery/" + k)
        for k in sorted(paired)[:5]:
            print("   lipsync/" + k)
        groups, unc = build_manifest(sorted(icons))
        print(f"\nmanifest: {len(groups)} グループ / {sum(len(g['items']) for g in groups)} 件"
              + (f"   （分類できず除外 {len(unc)} 件）" if unc else ""))
        print("\n確認のみでした。実行するには --dry を外してください。")
        return

    # ---- 3. 作る ----
    t0 = time.time()
    stamp = {} if args.force else load_stamp(root)
    icon_sig = f"icon/{args.icon_px}/{args.quality}"
    gif_sig = f"gif/{args.gif_px}/{args.lossy}/{'gifsicle' if gifsicle else 'pillow'}"

    made = skipped_same = failed = 0
    bytes_out = 0
    for i, (rel, src) in enumerate(sorted(icons.items()), 1):
        dst = os.path.join(root, "gallery", rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if up_to_date(stamp, "g/" + rel, src, dst, icon_sig):
            skipped_same += 1; bytes_out += os.path.getsize(dst); continue
        try:
            convert_icon(src, dst, args.icon_px, args.quality)
            mark(stamp, "g/" + rel, src, icon_sig)
            made += 1; bytes_out += os.path.getsize(dst)
        except Exception as e:
            print(f"  [失敗] gallery/{rel}: {e}"); failed += 1
        if i % 200 == 0:
            print(f"  アイコン {i}/{len(icons)} ...")
    print(f"アイコン: 作成 {made} / 変更なし {skipped_same} / 失敗 {failed}  計 {human(bytes_out)}")

    gmade = gsame = gfail = 0
    gbytes = 0
    for i, (rel, src) in enumerate(sorted(paired.items()), 1):
        dst = os.path.join(root, "lipsync", rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if up_to_date(stamp, "l/" + rel, src, dst, gif_sig):
            gsame += 1; gbytes += os.path.getsize(dst); continue
        try:
            if gifsicle:
                convert_gif_gifsicle(gifsicle, src, dst, args.gif_px, args.lossy)
            else:
                convert_gif_pillow(src, dst, args.gif_px)
            mark(stamp, "l/" + rel, src, gif_sig)
            gmade += 1; gbytes += os.path.getsize(dst)
        except Exception as e:
            print(f"  [失敗] lipsync/{rel}: {e}"); gfail += 1
        if i % 100 == 0:
            print(f"  口パクGIF {i}/{len(paired)} ...")
    print(f"口パクGIF: 作成 {gmade} / 変更なし {gsame} / 失敗 {gfail}  計 {human(gbytes)}")

    save_stamp(root, stamp)

    # ---- 4. 古いものを消す ----
    if not args.keep_stale:
        removed = 0
        for rel in stale:
            try:
                os.remove(os.path.join(root, "gallery", rel.replace("/", os.sep))); removed += 1
            except OSError:
                pass
        for rel in stale_lip:
            try:
                os.remove(os.path.join(root, "lipsync", rel.replace("/", os.sep))); removed += 1
            except OSError:
                pass
        for sub in ("gallery", "lipsync"):
            for dp, _d, _f in sorted(os.walk(os.path.join(root, sub)), reverse=True):
                if not os.listdir(dp):
                    try: os.rmdir(dp)
                    except OSError: pass
        print(f"古いファイル: {removed} 件 消しました")

    # ---- 5. manifest ----
    groups, unc = build_manifest(sorted(icons))
    out = os.path.join(root, "data", "gallery-manifest.json")
    if os.path.exists(out):
        shutil.copyfile(out, out + ".bak")
    manifest = {"version": 2,
                "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "groups": groups}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, separators=(",", ":"))
    print(f"manifest: {len(groups)} グループ / {sum(len(g['items']) for g in groups)} 件 を書きました"
          + (f"   （分類できず除外 {len(unc)} 件）" if unc else ""))

    print()
    print("=" * 70)
    print(f"できあがり  gallery {human(bytes_out)} / lipsync {human(gbytes)}  "
          f"合計 {human(bytes_out + gbytes)}")
    print(f"いままで    gallery {human(sum(now_gal.values()))} / lipsync {human(sum(now_lip.values()))}  "
          f"合計 {human(sum(now_gal.values()) + sum(now_lip.values()))}")
    print(f"かかった時間 {time.time()-t0:.0f} 秒")
    if not gifsicle:
        print()
        print("[お知らせ] gifsicle が無いので、口パクGIFの圧縮は弱めです。")
        print("           https://eternallybored.org/misc/gifsicle/ から Windows版を取り、")
        print("           gifsicle.exe を tools\\gifsicle\\ に置いて、もう一度実行すると")
        print("           さらに半分ほどになります。")
    print("=" * 70)


if __name__ == "__main__":
    main()
