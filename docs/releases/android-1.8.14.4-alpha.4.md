# Pix-Scripting Android 1.8.14.4-alpha.4

> [!NOTE]
> 本发布为 Android 预览频道问题修复版（`--prerelease`，`--latest=false`），可直接在 `1.8.14.4-alpha.1` / `alpha.2` / `alpha.3` 上覆盖升级，保留已导入的配置与登录态，不会覆盖 iOS `Latest` 发布（`v1.8.14.4-pixivreader`）。

## 修复

- **小说「AI 导读与续写」正文反复刷屏**：
  - 根因：`streamSummarizeNovel` / `streamContinueNovel` 的 `onChunk` 回调传的是**本次请求的累计正文快照**（与 iOS `aiSheet` 的 `throttler.flush` 语义一致），而 Android 原生 `NovelAISheet` 误按增量分片处理，使用 `prev + chunk` 拼接。
  - 结果：每一个分片都把当前完整正文重新追加一次，界面表现为正文不断从开头重来、越刷越长，看起来像在无限循环提交。
  - 修复：`apps/android/src/app/features/novel/NovelAISheet.tsx` 改为整体替换为最新累计快照，导读总结与 AI 续写两条链路同时修正。
- **回归测试**：新增 `apps/android/tests/novel-ai-sheet-streaming.test.cjs`，在流式进行中用真实组件渲染断言中途正文等于最后一次累计快照；修复前该用例失败（输出被重复拼接），修复后通过。

## 签名与 Obtainium 配置

- **包名**：`com.pixscripting.preview`（`versionName = 1.8.14.4-alpha.4`，`versionCode = 4`）
- **签名证书 SHA-256**：`17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`
- **Release 附件**：`Pix-Scripting-Android.apk`、`SHA256SUMS`

## 未验证

- Android 真机上的导读总结实际流式观感、停止按钮中断、切换「全文总结 / 当前页」时的缓存行为仍需实机确认。
