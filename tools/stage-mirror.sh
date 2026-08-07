#!/bin/sh
# Stage a binary-free copy of the repo and push it to a public git mirror
# (Hugging Face static Space repo — free public git hosting for deploys).
# Usage: HF_USER=Kaylieu HF_SPACE=fareflow-src HF_TOKEN=hf_xxx sh tools/stage-mirror.sh
set -e
: "${HF_USER:?set HF_USER}" "${HF_SPACE:?set HF_SPACE}" "${HF_TOKEN:?set HF_TOKEN}"
STAGE=/tmp/ff-mirror
SRC="$(cd "$(dirname "$0")/.." && pwd)"

rm -rf "$STAGE"; mkdir -p "$STAGE"
(cd "$SRC" && tar cf - --exclude=.git --exclude=.gitignore --exclude=data.json --exclude=cloudflared .) | (cd "$STAGE" && tar xf -)
# binaries travel as text in tools/assets-b64.json — raw blobs must NOT be in this repo
find "$STAGE/public" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' -o -iname '*.gif' -o -iname '*.ico' \) -delete
echo "staged $(find "$STAGE" -type f | wc -l) files at $STAGE"

cd "$STAGE"
git init -q
git config user.email "fareflow@deploy.local"
git config user.name "FareFlow Deploy"
git add -A
git commit -qm "fareflow mirror $(date -u +%FT%TZ)"
git push --force -q "https://$HF_USER:$HF_TOKEN@huggingface.co/spaces/$HF_USER/$HF_SPACE" HEAD:main
echo "== mirror pushed: https://huggingface.co/spaces/$HF_USER/$HF_SPACE =="
