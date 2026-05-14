#!/usr/bin/env bash
# =============================================================================
# アニノベル 本番ビルドスクリプト
# 配置: scripts/build.sh
# 実行: bash scripts/build.sh
#
# 機能:
#   1. dist/ に成果物をコピー
#   2. HTML/CSS/JSをminify
#   3. JSを難読化 (オプション - 重いので環境変数で制御)
#   4. ビルドIDを埋込 (キャッシュバスター)
#   5. _headers, _redirects, functions/ をdistに配置
#
# 必要なツール (一度だけインストール):
#   npm install --no-save html-minifier-terser terser javascript-obfuscator clean-css-cli
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
SRC="$ROOT"

# ビルドID (Gitコミット or タイムスタンプ)
BUILD_ID="${GITHUB_SHA:-$(date -u +%Y%m%d_%H%M%S)}"
BUILD_ID="${BUILD_ID:0:12}"
echo "📦 ビルドID: $BUILD_ID"

# 難読化有無 (環境変数 OBFUSCATE=1 で有効化、ビルド時間が10倍になるので注意)
OBFUSCATE="${OBFUSCATE:-0}"

# ===== 1. dist の初期化 =====
echo "🧹 dist をクリーンアップ..."
rm -rf "$DIST"
mkdir -p "$DIST"

# ===== 2. 静的ファイルをコピー =====
echo "📋 ファイルをコピー..."
# functions/ は Cloudflare Pages が直接処理するので dist の外でもOKだが、
# pages_build_output_dir=dist に統一するために dist にも配置する必要はない
# (Cloudflare Pages は dist 配下を配信、functions/ は別途検出)
# → functions/ は dist の外に置く ✅
cp -r "$SRC/css" "$DIST/" 2>/dev/null || true
cp -r "$SRC/js" "$DIST/" 2>/dev/null || true
cp -r "$SRC/data" "$DIST/" 2>/dev/null || true
cp -r "$SRC/icons" "$DIST/" 2>/dev/null || true
cp -r "$SRC/legal" "$DIST/" 2>/dev/null || true
cp "$SRC"/*.html "$DIST/" 2>/dev/null || true
cp "$SRC/manifest.json" "$DIST/" 2>/dev/null || true
cp "$SRC/sw.js" "$DIST/" 2>/dev/null || true
cp "$SRC/robots.txt" "$DIST/" 2>/dev/null || true
cp "$SRC/sitemap.xml" "$DIST/" 2>/dev/null || true
cp "$SRC/og-image.svg" "$DIST/" 2>/dev/null || true

# _headers, _redirects (Cloudflare Pages特有)
cp "$SRC/_headers" "$DIST/" 2>/dev/null || true
cp "$SRC/_redirects" "$DIST/" 2>/dev/null || true

# ローカル開発専用は除外
rm -f "$DIST/start.bat" "$DIST/server.cjs" "$DIST/README_LOCAL.txt"

# ===== 3. ビルドID埋込 =====
echo "🏷  ビルドIDを埋込み..."
# viewer.html の __ANINOVEL_BUILD__ を置換
if [ -f "$DIST/viewer.html" ]; then
  sed -i.bak "s/window.__ANINOVEL_BUILD__='[^']*';/window.__ANINOVEL_BUILD__='${BUILD_ID}';/g" "$DIST/viewer.html"
  rm -f "$DIST/viewer.html.bak"
fi
# sw.js のCACHE_VERSIONを置換
if [ -f "$DIST/sw.js" ]; then
  sed -i.bak "s/const CACHE_VERSION = 'aninovel-[^']*';/const CACHE_VERSION = 'aninovel-${BUILD_ID}';/g" "$DIST/sw.js"
  rm -f "$DIST/sw.js.bak"
fi

# ===== 4. JS minify =====
echo "🗜  JS minify..."
if command -v terser >/dev/null 2>&1; then
  find "$DIST/js" -name "*.js" -type f | while read -r f; do
    terser "$f" \
      --compress passes=2,drop_console=false,drop_debugger=true \
      --mangle \
      --output "$f.min"
    mv "$f.min" "$f"
  done
  echo "  ✓ terser 完了"
else
  echo "  ⚠ terser 未インストール、minifyスキップ"
fi

# ===== 5. JS 難読化 (オプション) =====
if [ "$OBFUSCATE" = "1" ] && command -v javascript-obfuscator >/dev/null 2>&1; then
  echo "🔒 JS obfuscate..."
  for f in "$DIST/js/anti-piracy.js" "$DIST/js/billing.js" "$DIST/js/services.js"; do
    [ -f "$f" ] || continue
    javascript-obfuscator "$f" --output "$f.obf" \
      --compact true \
      --control-flow-flattening true --control-flow-flattening-threshold 0.6 \
      --dead-code-injection true --dead-code-injection-threshold 0.3 \
      --identifier-names-generator hexadecimal \
      --rename-globals false \
      --string-array true --string-array-encoding base64 --string-array-threshold 0.6 \
      --self-defending true \
      --transform-object-keys true
    mv "$f.obf" "$f"
  done
  echo "  ✓ 重要モジュールを難読化"
fi

# ===== 6. CSS minify =====
echo "🗜  CSS minify..."
if command -v cleancss >/dev/null 2>&1; then
  find "$DIST" -name "*.css" -type f | while read -r f; do
    cleancss -O 2 "$f" -o "$f.min"
    mv "$f.min" "$f"
  done
  echo "  ✓ clean-css 完了"
else
  echo "  ⚠ clean-css 未インストール、minifyスキップ"
fi

# ===== 7. HTML minify =====
echo "🗜  HTML minify..."
if command -v html-minifier-terser >/dev/null 2>&1; then
  find "$DIST" -name "*.html" -type f | while read -r f; do
    html-minifier-terser "$f" \
      --output "$f.min" \
      --collapse-whitespace \
      --remove-comments \
      --remove-redundant-attributes \
      --remove-script-type-attributes \
      --use-short-doctype \
      --minify-css true \
      --minify-js '{"compress":{"drop_console":false,"passes":2},"mangle":{"toplevel":false}}' || cp "$f" "$f.min"
    mv "$f.min" "$f"
  done
  echo "  ✓ html-minifier-terser 完了"
else
  echo "  ⚠ html-minifier-terser 未インストール、minifyスキップ"
fi

# ===== 8. 統計 =====
echo ""
echo "📊 ビルド統計:"
TOTAL=$(du -sh "$DIST" | awk '{print $1}')
FILES=$(find "$DIST" -type f | wc -l | xargs)
HTML_SIZE=$(find "$DIST" -name "*.html" -type f -exec du -ch {} + | tail -1 | awk '{print $1}')
JS_SIZE=$(find "$DIST/js" -name "*.js" -type f -exec du -ch {} + 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
echo "  合計: $TOTAL ($FILES ファイル)"
echo "  HTML: $HTML_SIZE"
echo "  JS:   $JS_SIZE"
echo "  ビルドID: $BUILD_ID"
echo ""
echo "✅ ビルド完了: $DIST"
echo ""
echo "次のステップ:"
echo "  ローカルテスト: wrangler pages dev $DIST"
echo "  本番デプロイ:   wrangler pages deploy $DIST --project-name=aninovel"
