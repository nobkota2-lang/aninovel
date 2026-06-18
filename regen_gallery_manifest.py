#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
regen_gallery_manifest.py  —  AniNovel
E:\\aninovel\\aninovel\\ で実行してください（gallery/ と data/ がある場所）。

  python regen_gallery_manifest.py

やること:
  1) gallery/<Gender>/<Race>_<Type>/<Age>/<file>.png を走査し、
     data/gallery-manifest.json を viewer が期待するスキーマで再生成。
  2) 各画像に対応する lipsync/<同じ相対パス>.gif の有無を集計（口パクのカバレッジ）。
  3) Cloudflare は大小文字を区別するため、lipsync 側のパスの【大小文字不一致】を検出して警告。

既存ファイルは data/gallery-manifest.json.bak に退避してから上書きします。
"""
import os, sys, json, urllib.parse, collections, shutil

ROOT = os.getcwd()
GALLERY = os.path.join(ROOT, "gallery")
LIPSYNC = os.path.join(ROOT, "lipsync")
OUT = os.path.join(ROOT, "data", "gallery-manifest.json")

AGE_ORDER = ["Baby", "Child", "Teen", "YoungAdult", "Adult", "MiddleAge", "Senior"]
KNOWN_TYPES = {"Anime", "AnimeGen", "Photo", "PhotoGen", "RetroManga",
               "RetroMangaGen", "Painterly", "Watercolor", "Pastel"}

def rel_posix(path, base):
    return os.path.relpath(path, base).replace(os.sep, "/")

def url_p(rel):
    # /gallery/ 配下の相対パスを、区切り '/' を保ったままURLエンコード
    return "/gallery/" + urllib.parse.quote(rel, safe="/")

def main():
    if not os.path.isdir(GALLERY):
        print("[ERROR] gallery/ が見つかりません。リポジトリのルート (E:\\aninovel\\aninovel) で実行してください。")
        sys.exit(1)

    # --- gallery 走査 ---
    groups = {}           # key=(Gender,Race,Type,Age) -> list[rel]
    skipped = []          # 構造に合わないパス
    gallery_rels = []     # 全PNGの相対パス(実大小文字)

    for dirpath, _dirs, files in os.walk(GALLERY):
        for fn in files:
            if not fn.lower().endswith(".png"):
                continue
            full = os.path.join(dirpath, fn)
            rel = rel_posix(full, GALLERY)        # 例: Female/Japanese_Anime/Baby/xxx.png
            gallery_rels.append(rel)
            parts = rel.split("/")
            if len(parts) != 4:
                skipped.append(rel); continue
            gender, styleset, age, _file = parts
            if "_" not in styleset:
                skipped.append(rel); continue
            race, typ = styleset.split("_", 1)
            groups.setdefault((gender, race, typ, age), []).append(rel)

    # --- グループ構築 ---
    out_groups = []
    for (gender, race, typ, age) in sorted(
            groups.keys(),
            key=lambda k: (k[0], k[1], k[2],
                           AGE_ORDER.index(k[3]) if k[3] in AGE_ORDER else 99)):
        rels = sorted(groups[(gender, race, typ, age)])
        out_groups.append({
            "id": f"{gender}_{race}_{typ}_{age}".lower(),
            "label": f"{gender} \u00b7 {race} {typ} \u00b7 {age}",
            "style": typ,
            "gender": gender,
            "race": race,
            "type": typ,
            "age": age,
            "ageBlock": AGE_ORDER.index(age) if age in AGE_ORDER else 99,
            "items": [{"p": url_p(r)} for r in rels],
        })

    total_imgs = sum(len(g["items"]) for g in out_groups)
    manifest = {
        "version": 10,
        "note": f"AniNovel Gallery v10 (gender x race x type x age, {total_imgs} images) - regenerated",
        "groups": out_groups,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if os.path.exists(OUT):
        shutil.copyfile(OUT, OUT + ".bak")
        print(f"[bak] 既存を退避: {OUT}.bak")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=0, separators=(",", ":"))
    print(f"[OK] 生成: {OUT}")
    print(f"     groups={len(out_groups)}  images={total_imgs}")
    print(f"     type別: {dict(collections.Counter(g['type'] for g in out_groups))}")
    if skipped:
        print(f"[WARN] 4階層(<Gender>/<Race>_<Type>/<Age>/<file>.png) に合わず除外: {len(skipped)} 件")
        for s in skipped[:10]:
            print("        -", s)
        if len(skipped) > 10:
            print(f"        ... 他 {len(skipped)-10} 件")
    unknown_types = sorted({g["type"] for g in out_groups} - KNOWN_TYPES)
    if unknown_types:
        print(f"[WARN] viewer未登録のtype（_typeOrder/_typeJaに無い→末尾表示）: {unknown_types}")

    # --- lipsync カバレッジ & 大小文字チェック ---
    if os.path.isdir(LIPSYNC):
        lip_rels = set()
        lip_lower = {}   # lower(rel) -> 実大小文字rel
        for dp, _d, fs in os.walk(LIPSYNC):
            for fn in fs:
                if fn.lower().endswith(".gif"):
                    r = rel_posix(os.path.join(dp, fn), LIPSYNC)
                    lip_rels.add(r); lip_lower[r.lower()] = r
        have = miss = case = 0
        case_examples = []
        for rel in gallery_rels:
            expect = rel[:-4] + ".gif" if rel.lower().endswith(".png") else None
            if not expect:
                continue
            if expect in lip_rels:
                have += 1
            elif expect.lower() in lip_lower:
                case += 1
                if len(case_examples) < 10:
                    case_examples.append((lip_lower[expect.lower()], expect))
            else:
                miss += 1
        print("\n[lipsync] 口パクGIFカバレッジ")
        print(f"     一致(配信OK)={have}  大小文字不一致={case}  無し={miss}  / 画像{len(gallery_rels)}")
        if case:
            print("[WARN] 大小文字不一致（Cloudflareは区別＝404になる）。例: 実ファイル → 期待")
            for actual, exp in case_examples:
                print(f"        lipsync/{actual}  →  lipsync/{exp}")
            print("       → galleryと同じ大小文字に揃えてください（例: git mv で male→Male）。")
    else:
        print("\n[lipsync] lipsync/ が無いためカバレッジ未計算。")

if __name__ == "__main__":
    main()
