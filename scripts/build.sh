#!/usr/bin/env bash
# =============================================================================
# 繧｢繝九ヮ繝吶Ν 譛ｬ逡ｪ繝薙Ν繝峨せ繧ｯ繝ｪ繝励ヨ
# 驟咲ｽｮ: scripts/build.sh
# 螳溯｡・ bash scripts/build.sh
#
# 讖溯・:
#   1. dist/ 縺ｫ謌先棡迚ｩ繧偵さ繝斐・
#   2. HTML/CSS/JS繧知inify
#   3. JS繧帝屮隱ｭ蛹・(繧ｪ繝励す繝ｧ繝ｳ - 驥阪＞縺ｮ縺ｧ迺ｰ蠅・､画焚縺ｧ蛻ｶ蠕｡)
#   4. 繝薙Ν繝迂D繧貞沂霎ｼ (繧ｭ繝｣繝・す繝･繝舌せ繧ｿ繝ｼ)
#   5. _headers, _redirects, functions/ 繧壇ist縺ｫ驟咲ｽｮ
#
# 蠢・ｦ√↑繝・・繝ｫ (荳蠎ｦ縺縺代う繝ｳ繧ｹ繝医・繝ｫ):
#   npm install --no-save html-minifier-terser terser javascript-obfuscator clean-css-cli
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
SRC="$ROOT"

# 繝薙Ν繝迂D (Git繧ｳ繝溘ャ繝・or 繧ｿ繧､繝繧ｹ繧ｿ繝ｳ繝・
BUILD_ID="${GITHUB_SHA:-$(date -u +%Y%m%d_%H%M%S)}"
BUILD_ID="${BUILD_ID:0:12}"
echo "逃 繝薙Ν繝迂D: $BUILD_ID"

# 髮｣隱ｭ蛹匁怏辟｡ (迺ｰ蠅・､画焚 OBFUSCATE=1 縺ｧ譛牙柑蛹悶√ン繝ｫ繝画凾髢薙′10蛟阪↓縺ｪ繧九・縺ｧ豕ｨ諢・
OBFUSCATE="${OBFUSCATE:-0}"

# ===== 1. dist 縺ｮ蛻晄悄蛹・=====
echo "ｧｹ dist 繧偵け繝ｪ繝ｼ繝ｳ繧｢繝・・..."
rm -rf "$DIST"
mkdir -p "$DIST"

# ===== 2. 髱咏噪繝輔ぃ繧､繝ｫ繧偵さ繝斐・ =====
echo "搭 繝輔ぃ繧､繝ｫ繧偵さ繝斐・..."
# functions/ 縺ｯ Cloudflare Pages 縺檎峩謗･蜃ｦ逅・☆繧九・縺ｧ dist 縺ｮ螟悶〒繧０K縺縺後・
# pages_build_output_dir=dist 縺ｫ邨ｱ荳縺吶ｋ縺溘ａ縺ｫ dist 縺ｫ繧る・鄂ｮ縺吶ｋ蠢・ｦ√・縺ｪ縺・
# (Cloudflare Pages 縺ｯ dist 驟堺ｸ九ｒ驟堺ｿ｡縲’unctions/ 縺ｯ蛻･騾疲､懷・)
# 竊・functions/ 縺ｯ dist 縺ｮ螟悶↓鄂ｮ縺・笨・
cp -r "$SRC/css" "$DIST/" 2>/dev/null || true
cp -r "$SRC/js" "$DIST/" 2>/dev/null || true
cp -r "$SRC/data" "$DIST/" 2>/dev/null || true
cp -r "$SRC/icons" "$DIST/" 2>/dev/null || true
cp -r "$SRC/legal" "$DIST/" 2>/dev/null || true
cp -r "$SRC/gallery" "$DIST/" 2>/dev/null || true
cp -r "$SRC/lipsync" "$DIST/" 2>/dev/null || true
cp -r "$SRC/gallery" "$DIST/" 2>/dev/null || true
cp -r "$SRC/lipsync" "$DIST/" 2>/dev/null || true
cp "$SRC"/*.html "$DIST/" 2>/dev/null || true
cp "$SRC/manifest.json" "$DIST/" 2>/dev/null || true
cp "$SRC/sw.js" "$DIST/" 2>/dev/null || true
cp "$SRC/robots.txt" "$DIST/" 2>/dev/null || true
cp "$SRC/sitemap.xml" "$DIST/" 2>/dev/null || true
cp "$SRC/og-image.svg" "$DIST/" 2>/dev/null || true

# _headers, _redirects (Cloudflare Pages迚ｹ譛・
cp "$SRC/_headers" "$DIST/" 2>/dev/null || true
cp "$SRC/_redirects" "$DIST/" 2>/dev/null || true

# 繝ｭ繝ｼ繧ｫ繝ｫ髢狗匱蟆ら畑縺ｯ髯､螟・
rm -f "$DIST/start.bat" "$DIST/server.cjs" "$DIST/README_LOCAL.txt"

# ===== 3. 繝薙Ν繝迂D蝓玖ｾｼ =====
echo "捷  繝薙Ν繝迂D繧貞沂霎ｼ縺ｿ..."
# viewer.html 縺ｮ __ANINOVEL_BUILD__ 繧堤ｽｮ謠・
if [ -f "$DIST/viewer.html" ]; then
  sed -i.bak "s/window.__ANINOVEL_BUILD__='[^']*';/window.__ANINOVEL_BUILD__='${BUILD_ID}';/g" "$DIST/viewer.html"
  rm -f "$DIST/viewer.html.bak"
fi
# sw.js 縺ｮCACHE_VERSION繧堤ｽｮ謠・
if [ -f "$DIST/sw.js" ]; then
  sed -i.bak "s/const CACHE_VERSION = 'aninovel-[^']*';/const CACHE_VERSION = 'aninovel-${BUILD_ID}';/g" "$DIST/sw.js"
  rm -f "$DIST/sw.js.bak"
fi

# ===== 4. JS minify =====
echo "梨  JS minify..."
if command -v terser >/dev/null 2>&1; then
  find "$DIST/js" -name "*.js" -type f | while read -r f; do
    terser "$f" \
      --compress passes=2,drop_console=false,drop_debugger=true \
      --mangle \
      --output "$f.min"
    mv "$f.min" "$f"
  done
  echo "  笨・terser 螳御ｺ・
else
  echo "  笞 terser 譛ｪ繧､繝ｳ繧ｹ繝医・繝ｫ縲［inify繧ｹ繧ｭ繝・・"
fi

# ===== 5. JS 髮｣隱ｭ蛹・(繧ｪ繝励す繝ｧ繝ｳ) =====
if [ "$OBFUSCATE" = "1" ] && command -v javascript-obfuscator >/dev/null 2>&1; then
  echo "白 JS obfuscate..."
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
  echo "  笨・驥崎ｦ√Δ繧ｸ繝･繝ｼ繝ｫ繧帝屮隱ｭ蛹・
fi

# ===== 6. CSS minify =====
echo "梨  CSS minify..."
if command -v cleancss >/dev/null 2>&1; then
  find "$DIST" -name "*.css" -type f | while read -r f; do
    cleancss -O 2 "$f" -o "$f.min"
    mv "$f.min" "$f"
  done
  echo "  笨・clean-css 螳御ｺ・
else
  echo "  笞 clean-css 譛ｪ繧､繝ｳ繧ｹ繝医・繝ｫ縲［inify繧ｹ繧ｭ繝・・"
fi

# ===== 7. HTML minify =====
echo "梨  HTML minify..."
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
  echo "  笨・html-minifier-terser 螳御ｺ・
else
  echo "  笞 html-minifier-terser 譛ｪ繧､繝ｳ繧ｹ繝医・繝ｫ縲［inify繧ｹ繧ｭ繝・・"
fi

# ===== 8. 邨ｱ險・=====
echo ""
echo "投 繝薙Ν繝臥ｵｱ險・"
TOTAL=$(du -sh "$DIST" | awk '{print $1}')
FILES=$(find "$DIST" -type f | wc -l | xargs)
HTML_SIZE=$(find "$DIST" -name "*.html" -type f -exec du -ch {} + | tail -1 | awk '{print $1}')
JS_SIZE=$(find "$DIST/js" -name "*.js" -type f -exec du -ch {} + 2>/dev/null | tail -1 | awk '{print $1}' || echo "0")
echo "  蜷郁ｨ・ $TOTAL ($FILES 繝輔ぃ繧､繝ｫ)"
echo "  HTML: $HTML_SIZE"
echo "  JS:   $JS_SIZE"
echo "  繝薙Ν繝迂D: $BUILD_ID"
echo ""
echo "笨・繝薙Ν繝牙ｮ御ｺ・ $DIST"
echo ""
echo "谺｡縺ｮ繧ｹ繝・ャ繝・"
echo "  繝ｭ繝ｼ繧ｫ繝ｫ繝・せ繝・ wrangler pages dev $DIST"
echo "  譛ｬ逡ｪ繝・・繝ｭ繧､:   wrangler pages deploy $DIST --project-name=aninovel"
