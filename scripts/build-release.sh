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
if (!manifest.remoteResource?.url?.includes("/feature/pixivreader-port/Release/Pix-Scripting.scripting")) {
  throw new Error("发布地址未指向本分支")
}
'

temp_dir="$(mktemp -d "$repo_dir/Release/.build-XXXXXX")"
trap 'rm -f "$temp_dir/Pix-Scripting.scripting"; rmdir "$temp_dir"' EXIT
zip -q -X -r "$temp_dir/Pix-Scripting.scripting" Pix-Scripting -x '*/.DS_Store' '*/node_modules/*'
unzip -tq "$temp_dir/Pix-Scripting.scripting"
mv -f "$temp_dir/Pix-Scripting.scripting" "$repo_dir/Release/Pix-Scripting.scripting"
echo "已生成 Release/Pix-Scripting.scripting"
