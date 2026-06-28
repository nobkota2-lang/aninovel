#!/usr/bin/env bash
# =============================================================================
# AniNovel production build script  (UTF-8 safe, permanent)
# Location: scripts/build.sh
# =============================================================================
set -eo pipefail
export LC_ALL=C.UTF-8 2>/dev/null || true
export LANG=C.UTF-8 2>/dev/null || true
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
SRC="$ROOT"
BUILD_ID="${GITHUB_SHA:-$(date -u +%Y%m%d_%H%M%S)}"
BUILD_ID="${BUILD_ID:0:12}"
echo "[build] BUILD_ID: $BUILD_ID"
OBFUSCATE="${OBFUSCATE:-0}"

# ===== 1. Reset dist =====
echo "[build] Cleaning dist..."
rm -rf "$DIST"
mkdir -p "$DIST"

# ===== 2. Copy static files =====
echo "[build] Copying files..."
cp -r "$SRC/css" "$DIST/" 2>/dev/null || true
cp -r "$SRC/js" "$DIST/" 2>/dev/null || true
cp -r "$SRC/data" "$DIST/" 2>/dev/null || true
cp -r "$SRC/icons" "$DIST/" 2>/dev/null || true
cp -r "$SRC/legal" "$DIST/" 2>/dev/null || true
cp -r "$SRC/gallery" "$DIST/" 2>/dev/null || true
cp -r "$SRC/lipsync" "$DIST/" 2>/dev/null || true
cp "$SRC"/*.html "$DIST/" 2>/dev/null || true
cp "$SRC/manifest.json" "$DIST/" 2>/dev/null || true
cp "$SRC/sw.js" "$DIST/" 2>/dev/null || true
cp "$SRC/robots.txt" "$DIST/" 2>/dev/null || true
cp "$SRC/sitemap.xml" "$DIST/" 2>/dev/null || true
cp "$SRC/og-image.svg" "$DIST/" 2>/dev/null || true
cp "$SRC/_headers" "$DIST/" 2>/dev/null || true
cp "$SRC/_redirects" "$DIST/" 2>/dev/null || true
rm -f "$DIST/start.bat" "$DIST/server.cjs" "$DIST/README_LOCAL.txt"

# ===== 3. Inject build ID =====
echo "[build] Injecting build ID..."
if [ -f "$DIST/viewer.html" ]; then
  sed -i.bak "s/window.__ANINOVEL_BUILD__='[^']*';/window.__ANINOVEL_BUILD__='${BUILD_ID}';/g" "$DIST/viewer.html"
  rm -f "$DIST/viewer.html.bak"
fi
if [ -f "$DIST/sw.js" ]; then
  sed -i.bak "s/const CACHE_VERSION = 'aninovel-[^']*';/const CACHE_VERSION = 'aninovel-${BUILD_ID}';/g" "$DIST/sw.js"
  rm -f "$DIST/sw.js.bak"
fi

# ===== 4. JS minify (UTF-8 preserved; portal.js excluded) =====
echo "[build] JS minify..."
if command -v terser >/dev/null 2>&1; then
  find "$DIST/js" -name "*.js" -type f | while read -r f; do
    case "$f" in
      */portal.js) echo "  [skip minify] portal.js (preserve UTF-8)"; continue;;
    esac
    terser "$f" \
      --compress passes=2,drop_console=false,drop_debugger=true \
      --mangle \
      --format ascii_only=false \
      --output "$f.min"
    mv "$f.min" "$f"
  done
  echo "  [ok] terser done"
else
  echo "  [skip] terser not installed"
fi

# ===== 5. JS obfuscate (optional) =====
if [ "$OBFUSCATE" = "1" ] && command -v javascript-obfuscator >/dev/null 2>&1; then
  echo "[build] JS obfuscate..."
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
      --transform-object-keys true \
      --unicode-escape-sequence false
    mv "$f.obf" "$f"
  done
  echo "  [ok] core modules obfuscated"
fi

# ===== 6. CSS minify =====
echo "[build] CSS minify..."
if command -v cleancss >/dev/null 2>&1; then
  find "$DIST" -name "*.css" -type f | while read -r f; do
    cleancss -O 2 "$f" -o "$f.min"
    mv "$f.min" "$f"
  done
  echo "  [ok] clean-css done"
else
  echo "  [skip] clean-css not installed"
fi

# ===== 7. HTML minify (UTF-8 preserved) =====
echo "[build] HTML minify..."
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
      --minify-js '{"compress":{"drop_console":false,"passes":2},"mangle":{"toplevel":false},"format":{"ascii_only":false}}' || cp "$f" "$f.min"
    mv "$f.min" "$f"
  done
  echo "  [ok] html-minifier-terser done"
else
  echo "  [skip] html-minifier-terser not installed"
fi

# ===== 8. Stats =====
echo ""
echo "[build] Summary:"
TOTAL=$(du -sh "$DIST" | awk '{print $1}')
FILES=$(find "$DIST" -type f | wc -l | xargs)
echo "  total: $TOTAL ($FILES files)"
echo "  BUILD_ID: $BUILD_ID"
echo ""
echo "[build] Done: $DIST"