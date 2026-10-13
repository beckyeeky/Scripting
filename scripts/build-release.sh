#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

for tool in node zip unzip; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "缺少构建工具：$tool" >&2
    exit 1
  fi
done

node -e '
const fs = require("fs")
const manifest = JSON.parse(fs.readFileSync("Pix-Scripting/script.json", "utf8"))
const config = fs.readFileSync("Pix-Scripting/src/config.ts", "utf8")
if (!config.includes(`"${manifest.version}"`)) throw new Error("script.json 与 config.ts 版本号不一致")
if (!/^\d+\.\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("版本号应为上游三段版本加移植小版本")
const url = manifest.remoteResource?.url ?? ""
if (!/^https:\/\/raw\.githubusercontent\.com\/beckyeeky\/Scripting\/.+\/Release\/Pix-Scripting\.scripting$/.test(url)) {
  throw new Error("发布地址必须指向本仓库分支的 Release/Pix-Scripting.scripting")
}
'

# 包内更新地址必须与当前分支一致，避免上游或其它分支的自动更新覆盖本分支发布包
current_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
package_url="$(node -e 'const m=require("./Pix-Scripting/script.json");process.stdout.write(m.remoteResource?.url||"")')"
prefix="https://raw.githubusercontent.com/beckyeeky/Scripting/"
suffix="/Release/Pix-Scripting.scripting"
package_branch="${package_url#"$prefix"}"
package_branch="${package_branch%"$suffix"}"
if [ "$current_branch" != "HEAD" ] && [ "$current_branch" != "$package_branch" ]; then
  echo "remoteResource.url 指向 $package_branch，而当前分支为 $current_branch" >&2
  exit 1
fi

temp_dir="$(mktemp -d "$repo_dir/Release/.build-XXXXXX")"
trap 'rm -f "$temp_dir/Pix-Scripting.scripting"; rm -rf "$temp_dir/Pix-Scripting"; rmdir "$temp_dir" 2>/dev/null || true' EXIT
zip -q -X -r "$temp_dir/Pix-Scripting.scripting" Pix-Scripting -x '*/.DS_Store' '*/node_modules/*'
unzip -tq "$temp_dir/Pix-Scripting.scripting"
mv -f "$temp_dir/Pix-Scripting.scripting" "$repo_dir/Release/Pix-Scripting.scripting"
echo "已生成 Release/Pix-Scripting.scripting"

# 工作树与打包内容必须逐字节一致
bash scripts/verify-release-package.sh
