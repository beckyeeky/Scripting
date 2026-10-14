# Scripting 脚本合集

专为 **[Scripting](https://apps.apple.com/app/scripting/id6477833076)** 平台打造的 iOS / iPadOS 高品质原生体验脚本合集。

### 📑 脚本项目索引

| 项目名称 | 类型 / 简介 | 当前版本 | 快速跳转 |
| :--- | :--- | :---: | :---: |
| **Pix-Scripting** | 液态玻璃风格 Pixiv 客户端，含 PixivReader 正文翻译移植 | `v1.7.13.7` | [查看介绍 & 安装](#pix-scripting) |
| *（更多项目）* | 更多高品质脚本持续孵化中... | `Planning` | - |

---

<h2 id="pix-scripting">🎨 Pix-Scripting</h2>

> 专为 iOS / iPadOS 打造的液态玻璃（Liquid Glass）风格 Pixiv 客户端脚本。

#### ✨ 特色功能

- 🎨 **液态玻璃与全景沉浸**：全透明贯穿导航，支持空间物理光影、极光等 6 种动态环境光引擎随作品流光溢彩；支持全域自定义玻璃色调注入与着色浓度精细调节。
- 🖼️ **原图流式浏览 & 动图转码**：插画/漫画长图秒开与分块预取；动态图（Ugoira）原生硬件加速合成导出 MP4 / GIF。
- 📖 **小说日式文库本阅读**：支持横向流式与纵向文库本（注音/标点悬挂），插图双向握手加载，预设多种主题并支持一键导出 EPUB 电子书。
- 📰 **Pixivision 官方特辑画报**：完整排版还原特辑长图文与创作者访谈，支持全局内存级极速缓存、多图离线导出、底栏全局配件与即刻直出。
- 🤖 **AI 深度集成与多模态扩展**：支持自定义模型（OpenAI / Gemini / Claude 等），提供画作画面解析、提示词逆向、AI 生图/图生图扩展及小说正文内逐段翻译与速读摘要。译文直接显示在原文位置，可随时切回原文，不打开单独的译文窗口。
- 🏝️ **系统级深度集成**：灵动岛 / 锁屏实时下载进度、后台任务保活、桌面画框小组件、CBZ / EPUB 离线归档。
- 📱 **iPad 原生平行视界**：自适应左右双栏分栏架构，支持比例微调与大屏沉浸阅读。
- 🔒 **纯净安全与本地优先**：官方 PKCE 安全登录，凭据独立 Keychain 隔离，数据本地沙盒落盘并支持 iCloud 同步。

#### 📥 快速安装

1. 安装 **[Scripting](https://apps.apple.com/app/scripting/id6477833076)** App；
2. 下载并导入 [`Release/Pix-Scripting.scripting`](https://raw.githubusercontent.com/beckyeeky/Scripting/feature/pixivreader-port/Release/Pix-Scripting.scripting)；也可从 [v1.7.13.7 发布页](https://github.com/beckyeeky/Scripting/releases/tag/v1.7.13.7-pixivreader) 下载附件。该包为 `feature/pixivreader-port` 分支的移植版（prerelease），未合入 `main`；包内 `remoteResource.url` 指向本功能分支，不会被上游自动更新覆盖；
3. 在小说详情或沉浸阅读器中打开「正文翻译」，选择翻译、暂停/继续或原文/译文切换；在小说系列页可分批翻译当前已加载的章节。先在「设置 → 智能助手」配置模型，或使用可用的 Scripting 原生助手。

正文上方有常驻翻译进度条，可直接看已完成段数、摘要与术语状态、暂停/继续、原文/译文切换；展开「摘要与术语」可查看内容、系列继承的术语数及失败段落的单块重试。沉浸阅读时也显示浮动进度条。故事摘要先生成，术语表随后整理，最后最多两个正文请求并发；上下文失败时会显示状态并继续翻译正文。长篇摘要和术语表会抽取开头、中段、结尾各约 3000 字，避免只看到开头；超长正文块优先在换行或句末拆分，保留接缝空行与 Pixiv 链接。

使用自定义模型时，译文、摘要和术语表仅保存在当前设备的 Pixiv 账号专属目录；原文和阅读进度不被改写。缓存会比对原文块、整篇原文、标题及不含密钥的模型配置指纹，配置或内容变化后失效；内存会话还会校验分块布局，避免解析结果变化时显示旧块。首次升级到本版时，缺少标题指纹的旧译文需重新生成。Scripting 原生助手不暴露当前模型标识，无法可靠校验其缓存，因此译文仅在本次会话复用。系列翻译每批最多约 6 万原文字，模型请求可能收费；脚本退到后台时会暂停，可回到前台继续，若脚本已被系统结束则手动点「继续翻译」。若设备缓存写入失败，已生成译文仍会留在当前会话并提示，退出后可能需要重新翻译。可在「设置 → 缓存」清除当前账号的小说译文。

正文翻译、摘要与术语请求会尽可能向服务商发送关闭思考参数：直连 DeepSeek、支持 `none` 的 OpenAI 模型、Gemini 2.5 Flash，以及可关闭思考的 Claude 模型。Claude Sonnet 5.5 使用 `between_tools` 关闭前置思考（小说翻译不使用工具）；Claude Opus 5.5 等型号无法关闭。OpenRouter 会请求关闭，但是否生效取决于下游模型。不支持关闭的模型或 Scripting 原生助手会在详情中明确提示，不能把“隐藏思考文本”当成已关闭思考。具体支持边界以 [DeepSeek](https://api-docs.deepseek.com/guides/thinking_mode/)、[OpenAI](https://platform.openai.com/docs/api-reference/chat/create)、[Gemini](https://ai.google.dev/gemini-api/docs/generate-content/thinking) 和 [Claude](https://platform.claude.com/docs/en/build-with-claude/thinking) 官方文档为准。

小说系列页工具栏、底部操作栏「下载」以及追更卡片菜单「下载整本小说」均可选择原文 EPUB 或当前目标语言的译文 EPUB。译文导出复用已完成的翻译，包含各话的译名、简介和正文，并保留分页、章节与插图标记；任一话未完成翻译、正文获取失败或账号切换时，会停止导出并提示原因。译文文件名带目标语言和「译文」，便于与原文区分。

#### 🧪 v1.7.13.7（功能分支 feature/pixivreader-port）

- 本轮仅删除 NovelDetail.tsx 嵌套 Menu 后的逗号文本节点；保留工具栏数组中合法的 `</Menu>,` 分隔，不重构布局或接口。
- 新增全项目 Menu 子节点 TypeScript AST 回归：旧提交 131107a 检出一个非法逗号，新源码通过；真实源码渲染 harness 同时拒绝 Menu 的非空字符串与数字子节点。
- 逐文件测试 164 项通过（19 个测试文件），197 个 TS/TSX 语法检查通过；本轮未重启真机验收，用户删除逗号后仅确认诊断消失，不能宣称白屏已经彻底验收。
- 继承上一版小说详情 TDZ、竖排续读锚点与控制器、书库宿主导入修复。

> 在 `feature/pixivreader-port` 分支发布，包含小说离线书库、目录与正文检索、译文台账，以及此前的跨篇归属与导出完整性修复。

- **目录与正文检索**：小说详情底部可打开本篇目录与全文检索，命中可按段落跳转并在竖向引擎高亮命中片段；跳转前的位置会被记录，可一键「返回原位置」。锚点带正文版本、段内偏移与文本锚点，正文或排版变化后安全回退到同段而不是乱跳。
- **离线书库（按账号隔离）**：单篇「保存到离线书库」会把正文、元数据与**正文插图的真实字节**写入设备本地（复制而非引用阅读器缓存）。阅读器取图时离线优先，缓存被清理或断网重启后仍按账号显示；保存时未取到字节的插图记为「待补/缺地址」，阅读到该篇时会继续补齐，界面不会把待补说成完整。容量超限时按最近访问淘汰书库正文与插图字节，**绝不删除阅读进度与批注**。
- **系列离线保存**：小说系列页提供「保存系列离线（正文＋插图）」入口（底部操作区与工具栏菜单），逐话抓取正文并落盘，可随时停止；抓取失败的话进入缺章清单，系列清单不会标记为完整，重进系列页可继续。
- **网络失败回退与沉浸换篇**：详情接口不可用时用离线记录合成最小元数据继续阅读并标注「离线阅读」；沉浸阅读器内部换篇在网络失败但该话已离线保存时照常载入该话正文与插图，并在顶部标注离线来源，换篇失败时提示不再被立刻覆盖。
- **译文管理（台账）**：按「原文块指纹 + 模型与提示词配置指纹」判定段落状态，源文或模型配置改动后旧译文标记为失效，**失效段落不会静默复用**（导出会被明确拦下并要求重译）；术语表可编辑并锁定，锁定后不再自动重生成且始终进入提示词，系列术语只补缺；状态面板展开后显示术语条数、系列继承条数与**发送范围**（将向哪个类别的服务商发送标题、简介、多少个章节标题与正文段落、术语条数与目标语言，不含端点与密钥）。
- **跨篇归属与导出完整性修复（继承 v1.7.13.4）**：沉浸阅读器内部换章后，阅读进度、跳页与书签一律按当前作品写入，旧文档迟到的滚动进度按代际丢弃；系列导出缺章缺图会记录并在书内与文件名标注，插图失败不产生悬空引用；图片与章节正文仅在瞬时故障时有限重试，鉴权/权限/取消不重试。
- 未包含无关模块重构；现有权限与敏感配置未变更。桌面回归覆盖上述路径，但 iPhone/iPad 真机行为（WebView 消息、目录跳转手势、EPUB 实际打开、分享、小组件）仍需设备验收。

#### 修改源码与重新发布

这个分支的发布包由仓库内可直接编辑的 [`Pix-Scripting/`](Pix-Scripting/) 源码构建，不需要修改 `.scripting` 压缩包。小说翻译的主要修改点是 [`src/store/novelTranslation.ts`](Pix-Scripting/src/store/novelTranslation.ts)（任务和缓存）、[`src/api/aiService.ts`](Pix-Scripting/src/api/aiService.ts)（模型提示词）、[`src/api/aiAdapters/translationThinking.ts`](Pix-Scripting/src/api/aiAdapters/translationThinking.ts)（各模型关闭思考参数）、[`src/ui/NovelReader.tsx`](Pix-Scripting/src/ui/NovelReader.tsx)（原位显示）、[`src/ui/NovelTranslationStatus.tsx`](Pix-Scripting/src/ui/NovelTranslationStatus.tsx)（进度与重试）、[`src/ui/NovelDetail.tsx`](Pix-Scripting/src/ui/NovelDetail.tsx)（单篇入口）和 [`src/ui/seriesView.tsx`](Pix-Scripting/src/ui/seriesView.tsx)（系列入口）。直接在这些文件里改即可。

在仓库根目录运行 `npm ci && npm test` 可执行翻译链路回归测试；运行 `bash scripts/build-release.sh` 会检查版本号一致性并重建 `Release/Pix-Scripting.scripting`。构建只需要 `zip`、`unzip` 和 `node`；完成后将源码与发布包一起提交到对应发布分支（本次为 `feature/pixivreader-port`）。`bash scripts/verify-release-package.sh` 会逐字节核对发布包与工作树 `Pix-Scripting/`、并校验包内版本与更新地址。当前版本 `1.7.13.7` 表示基于上游 `1.7.13` 的第 7 个移植小版本（功能分支）；下次发布同步修改 [`script.json`](Pix-Scripting/script.json) 的 `version` 和 [`src/config.ts`](Pix-Scripting/src/config.ts) 的回退版本，再重新构建。此分支的 `remoteResource.url` 指向分支发布包，不会误更新到上游 `main`。

---

### 📄 开源许可

[MIT License](LICENSE)
