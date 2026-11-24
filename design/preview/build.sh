#!/usr/bin/env sh
# 把新 UI 组件打包成一个可直接打开的单文件预览：design/preview/preview.html
# 用法（在项目根目录，Git Bash）：sh design/preview/build.sh
set -e
cd "$(dirname "$0")"
../../node_modules/.bin/esbuild harness.tsx --bundle --outfile=out.js --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' --minify --log-level=warning
{
  sed -n '1,/<link rel="stylesheet"/p' index.html | sed '$d'
  echo "<style>"; cat out.css; echo "</style>"
  sed -n '/<style>/,/<div id="root">/p' index.html
  echo "<script>"; cat out.js; echo "</script></body></html>"
} > preview.html
rm -f out.js out.css
echo "built design/preview/preview.html"
