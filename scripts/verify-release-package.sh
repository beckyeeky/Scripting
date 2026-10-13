#!/usr/bin/env bash
set -euo pipefail

# 校验 Release/Pix-Scripting.scripting 与工作树中的 Pix-Scripting/ 逐字节一致，
# 并核对包内 script.json 版本与更新地址，避免发布包与源码脱节或被其它分支覆盖。
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

package="Release/Pix-Scripting.scripting"
[ -f "$package" ] || { echo "缺少发布包：$package" >&2; exit 1; }

for tool in unzip node cmp rg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "缺少校验工具：$tool" >&2
    exit 1
  fi
done

unzip -tq "$package" >/dev/null

temp_dir="$(mktemp -d "$repo_dir/Release/.verify-XXXXXX")"
trap 'rm -rf "$temp_dir"' EXIT
unzip -q "$package" -d "$temp_dir"

worktree_list="$(rg --files Pix-Scripting | sort)"
packaged_list="$(cd "$temp_dir" && rg --files Pix-Scripting | sort)"
if [ "$worktree_list" != "$packaged_list" ]; then
  echo "发布包文件清单与工作树不一致：" >&2
  diff <(printf '%s\n' "$worktree_list") <(printf '%s\n' "$packaged_list") >&2 || true
  exit 1
fi

mismatch=0
file_count=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  file_count=$((file_count + 1))
  if ! cmp -s "$file" "$temp_dir/$file"; then
    echo "内容不一致：$file" >&2
    mismatch=1
  fi
done <<< "$worktree_list"
[ "$mismatch" -eq 0 ] || exit 1

node -e '
const fs = require("fs")
const zipped = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const source = JSON.parse(fs.readFileSync("Pix-Scripting/script.json", "utf8"))
if (zipped.version !== source.version) throw new Error(`包内版本 ${zipped.version} 与源码 ${source.version} 不一致`)
if (zipped.remoteResource?.url !== source.remoteResource?.url) throw new Error("包内 remoteResource.url 与源码不一致")
if (zipped.name !== source.name) throw new Error("包内 name 与源码不一致")
console.log(`发布包元数据校验通过：${source.name} ${source.version} -> ${source.remoteResource.url}`)
' "$temp_dir/Pix-Scripting/script.json"

echo "工作树与打包内容逐字节一致（$file_count 个文件）"
