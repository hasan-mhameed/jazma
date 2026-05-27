#!/bin/bash
# ── تشغيله قبل كل رفع على GitHub ──
# ./bump.sh

TS=$(date +%s)

# استبدال __BUILDTIME__ بـ timestamp حالي
sed -i "s/v=__BUILDTIME__/v=${TS}/" index.html

# تحديث service worker
sed -i "s/jazma-v[0-9.]*/jazma-v${TS}/" service-worker.js

echo "✅ Version bumped to: ${TS}"
echo "   الآن: git add . && git commit -m 'bump' && git push"
