#!/bin/bash
TS=$(date +%s)

# 1. version في index.html
sed -i "s/main\.js?v=[0-9]*/main.js?v=${TS}/" index.html

# 2. service worker
sed -i "s/jazma-v[0-9]*/jazma-v${TS}/" service-worker.js

# 3. version في كل local imports داخل ملفات JS
find js -name "*.js" -print0 | xargs -0 perl -pi -e "
  s|from (\")(\.{1,2}/[^\"?]+)\.js(\?v=\d+)?(\")| 'from ' . \$1 . \$2 . '.js?v=${TS}' . \$4 |ge;
  s|from (\')(\.{1,2}/[^\'?]+)\.js(\?v=\d+)?(\')| 'from ' . \$1 . \$2 . '.js?v=${TS}' . \$4 |ge;
"

echo "✅ Version bumped to: ${TS}"

# رفع على GitHub
git add .
git commit -m "v${TS}"
git push

echo "🚀 تم الرفع على GitHub!"
