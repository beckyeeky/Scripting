# 项目交接

更新日期：2026-10-13。此文件记录当前状态；长期规则见 [AGENTS.md](AGENTS.md)。

## 修复分支快照（v1.7.13.4 实验修复版，2026-10-13）

- 分支：`fix/futurereader-novel-integrity-20261013`，基线 `abfaae4`（`feature/pixivreader-port` 最新提交）；未合并 `main` / `feature/pixivreader-port`。
- 版本：源码、`script.json`、`src/config.ts` 回退版本、README 与包内元数据均为 `1.7.13.4`；包内 `remoteResource.url` 指向本修复分支，避免上游自动更新覆盖。
- 改动：沉浸阅读器跨篇归属（进度/书签/跳页/关闭路由，旧文档迟到进度按代际丢弃）；系列导出完整性（缺章记录与书内标注、失败图片不产生悬空引用、`NovelExportReport`、文件名缺章缺图后缀）；下载失败分类与受控重试（鉴权/权限/取消不重试，取消向上传播）。
- 验证：`npm test` 全部通过（含新增 3 个测试文件）；新增测试在修复前代码上失败、修复后通过；`bash scripts/build-release.sh` + `bash scripts/verify-release-package.sh` 通过（188 个文件逐字节一致、包内元数据校验通过）。
- 未验证：无 iOS/iPadOS 真机与 Scripting App 宿主验收（阅读器交互、WebView 消息、EPUB 在阅读器中打开、分享、小组件）；未运行 `npx tsc --noEmit`（仓库无 tsconfig，不构成有效类型检查）。
- 下一步：真机核验跨篇阅读进度/书签归属与缺章缺图 EPUB 的实际效果；如获授权再将修复合入功能分支。

## 当前快照

- 分支：`feature/pixivreader-port`；本次文档工作基于 `10ad006`。
- 源码、README 与现有安装包元数据版本均为 `1.7.13.3`，基于上游 `1.7.13`。
- 远程配置：`origin` 为 `beckyeeky/Scripting`，`upstream` 为 `chaoscard/Scripting`；推送前已 fetch 功能分支，`HEAD...origin/feature/pixivreader-port` 为 `0 0`。
- 开始任务时工作区干净；本次仅新增四份协作文档，未修改业务代码、README、依赖或发布包。

## 已完成与现有能力

- 阅读目录、README、依赖/打包配置、主入口、存储/账号边界、小说翻译/阅读/导出路径及五个测试文件，建立长期规则、架构说明和决策记录。
- 当前源码具有原位正文翻译、摘要与术语、目标语言缓存、暂停/继续、失败块重试、原文/译文单篇导出及系列 EPUB 导出。
- 最近本地提交统一系列页工具栏、底部操作栏和追更菜单的原文/译文下载选择；前一提交涉及系列译文导出与沉浸阅读空白修复。提交信息不等于设备验收证据。

## 本次验证

- `npm test`：59 项通过，0 失败、0 跳过；执行环境 Node `v22.23.2`、npm `10.9.8`，使用已有依赖。
- `unzip -tq Release/Pix-Scripting.scripting`：现有包压缩数据完整；包内 `script.json` 版本及更新地址与源码一致。
- 文档本地相对链接、引用路径和 `git diff --no-index --check /dev/null <新增文件>` 检查通过。
- 用户已授权将四份文档提交并推送到 `origin/feature/pixivreader-port`；推送后以远程分支提交哈希核验结果。
- 本次未运行 `npm ci`、未重新打包、未创建标签/Release、未核验线上 Release，也未进行设备验证；纯文档推送不触发发版。

## 阻碍与待确定

- 文档任务无阻碍，当前桌面回归没有失败项。
- iPhone/iPad 验收待确定：两个阅读方向、翻译原位切换、退后台/最小化后恢复、账号切换、系列三个下载入口及缺章错误提示、EPUB 实际打开与分享。
- Scripting App、iOS/iPadOS 与 Node 的最低支持版本，CLI 同步配置和完整类型检查方案待确定；仓库没有相应配置或声明。
- 锁文件中的 TypeScript 下载地址为 `http://mirrors.tencentyun.com`；本次未验证新环境安装连通性。
- 功能分支远程状态已在推送前核对；上游最新提交、标签与 Release 附件状态待确定。

## 下一步

1. 后续任务先读 `AGENTS.md` 与此文件，根据用户任务推进；尚无新的业务功能排期。
2. 有设备条件时补齐上述验收，记录宿主版本、路径、结果与失败现象；无需因验收待确定而重复桌面测试。
3. 新环境先执行 `npm ci`、`npm test`；如安装失败，记录实际错误后处理依赖来源。
4. 若要求同步或发布，先核验当前分支与远程差异，再按长期规则完成指定范围的同步/完整发版。
