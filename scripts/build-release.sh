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

# 包内更新地址必须与「本次发布目标分支」一致，避免上游或其它分支的自动更新覆盖发布包。
# 显式目标：--target-branch <分支> 或环境变量 RELEASE_TARGET_BRANCH；默认取当前分支。
target_branch=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target-branch) target_branch="${2:-}"; shift 2 ;;
    --target-branch=*) target_branch="${1#*=}"; shift ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done
if [ -z "$target_branch" ]; then
  target_branch="${RELEASE_TARGET_BRANCH:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)}"
fi
package_url="$(node -e 'const m=require("./Pix-Scripting/script.json");process.stdout.write(m.remoteResource?.url||"")')"
prefix="https://raw.githubusercontent.com/beckyeeky/Scripting/"
suffix="/Release/Pix-Scripting.scripting"
package_branch="${package_url#"$prefix"}"
package_branch="${package_branch%"$suffix"}"
if [ "$target_branch" = "HEAD" ] || [ -z "$target_branch" ]; then
  echo "无法确定发布目标分支，请显式传入 --target-branch <分支>" >&2
  exit 1
fi
if [ "$target_branch" != "$package_branch" ]; then
  echo "remoteResource.url 指向 $package_branch，而发布目标分支为 $target_branch" >&2
  exit 1
fi
echo "发布目标分支：$target_branch（remoteResource.url 一致）"

temp_dir="$(mktemp -d "$repo_dir/Release/.build-XXXXXX")"
trap 'rm -f "$temp_dir/Pix-Scripting.scripting"; rm -rf "$temp_dir/Pix-Scripting"; rmdir "$temp_dir" 2>/dev/null || true' EXIT
zip -q -X -r "$temp_dir/Pix-Scripting.scripting" Pix-Scripting -x '*/.DS_Store' '*/node_modules/*'
unzip -tq "$temp_dir/Pix-Scripting.scripting"
mv -f "$temp_dir/Pix-Scripting.scripting" "$repo_dir/Release/Pix-Scripting.scripting"
echo "已生成 Release/Pix-Scripting.scripting"

# 工作树与打包内容必须逐字节一致
bash scripts/verify-release-package.sh --target-branch "$target_branch"
