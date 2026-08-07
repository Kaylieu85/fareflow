#!/bin/sh
# One-command Hugging Face Spaces deploy. Usage:
#   HF_USER=yourname HF_SPACE=fareflow HF_TOKEN=hf_xxx sh tools/hf-deploy.sh
set -e
: "${HF_USER:?set HF_USER}" "${HF_SPACE:?set HF_SPACE}" "${HF_TOKEN:?set HF_TOKEN}"
REPO="spaces/$HF_USER/$HF_SPACE"
echo "== creating $REPO (safe if it already exists) =="
curl -s -X POST "https://huggingface.co/api/repos/create" \
  -H "Authorization: Bearer $HF_TOKEN" -H "Content-Type: application/json" \
  -d "{\"type\":\"space\",\"name\":\"$HF_SPACE\",\"sdk\":\"'${HF_SDK:-docker}'\",\"private\":false}" | head -c 240; echo
[ -d .git ] || git init -q
git config user.email "fareflow@deploy.local"
git config user.name "FareFlow Deploy"
git add -A
git diff --cached --quiet || git commit -qm "deploy: fareflow $(date -u +%FT%TZ)"
git remote remove hf 2>/dev/null || true
git remote add hf "https://$HF_USER:$HF_TOKEN@huggingface.co/$REPO"
git push --force -q hf HEAD:main
git remote remove hf
echo "== pushed to https://huggingface.co/$REPO =="
