#!/usr/bin/env bash
# リポジトリに入れてはいけないものを探す。見つかったら 1 で終わる。
# ローカルでも動く:  bash scripts/guard-files.sh
# -f は glob 展開を止める。これが無いと、下の一覧の *.zip を
# シェルがカレントディレクトリに対して展開してしまい、
# 「いま手元にある .zip」しか見なくなる(部分木の見落としになる)。
set -u -f

ng=0
say() { printf '%s\n' "$*"; }

# ---- 1) ファイル名で弾く ----
# 書庫・控え・内部文書・鍵・実行ファイル。
# 足すときは、なぜ入れてはいけないのかを一行書くこと。
patterns='
*.zip
*.bak
*.skill
*.exe
*.dll
*.key
*.pem
*.p12
*.pfx
*.pdb
*.sqlite
*.sqlite3
*.db
.env
.env.*
_preview*
aninovel-status.md
journal.txt
'

for p in $patterns; do
  hits=$(git ls-files -- "$p" ":(glob)**/$p" 2>/dev/null | sort -u)
  if [ -n "$hits" ]; then
    say "NG  入れてはいけない名前のファイル ($p):"
    printf '      %s\n' $hits
    ng=1
  fi
done

# ---- 2) 中身で弾く ----
# 鍵らしきものだけを狙う。package-lock.json などの長い16進に当たらないよう、
# 「鍵の名前 + 代入 + 長い値」の形か、はっきりした接頭辞だけを見る。
files=$(git ls-files -- '*.js' '*.mjs' '*.cjs' '*.html' '*.json' '*.yml' '*.yaml' '*.sh' '*.ps1' '*.py' '*.md' \
        | grep -v -E '(^|/)(package-lock\.json|\.assets-build\.json)$' || true)

if [ -n "$files" ]; then
  if printf '%s\n' $files | xargs -r grep -n -E \
      -e '(sk|rk)_(live|test)_[A-Za-z0-9]{16,}' \
      -e 'whsec_[A-Za-z0-9]{16,}' \
      -e 'AKIA[0-9A-Z]{16}' \
      -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
      -e 'https://discord\.com/api/webhooks/[0-9]{5,}/[A-Za-z0-9_-]{10,}' \
      -e 'https://hooks\.slack\.com/services/T[A-Za-z0-9]+/B[A-Za-z0-9]+/[A-Za-z0-9]{10,}' \
      2>/dev/null; then
    say 'NG  鍵らしきものが書かれています'
    ng=1
  fi
  if printf '%s\n' $files | xargs -r grep -n -i -E \
      '(api[_-]?key|secret|password|passwd|auth[_-]?token|access[_-]?token|client[_-]?secret)[[:space:]]*[:=][[:space:]]*.?[A-Za-z0-9_\-]{24,}' \
      2>/dev/null; then
    say 'NG  鍵らしきものが書かれています(名前つき)'
    ng=1
  fi
fi

if [ "$ng" -eq 0 ]; then
  say 'OK  配信してはいけないものは見つかりませんでした'
fi
exit "$ng"
