# Pix-Scripting Android

Android 版从 `feat/android-app` 分支构建，基于 React Native `0.76.7` + Hermes + `@shopify/flash-list` + Kotlin 原生桥接：采用专为 Android 打造的原生 React Native 界面层（`apps/android/src/app/`），同时通过无头 `"scripting"` 宿主运行时（`apps/android/src/scripting/`）零修改直接复用 `Pix-Scripting/src/` 全部核心业务逻辑、小说行内标记/翻译台账、导出器与跨设备同步协议。

## 功能与特性

- **Android 原生体验**：Edge-to-Edge 全面屏 insets 实时同步（含软键盘 `imeBottom`）、深浅主题与自定义强调色、5 Tab 独立导航栈与单根硬件返回键协调、单一根级 `OverlayHost`（零 RN `<Modal>` 叠层冲突）、`MasonryFlashList`/`FlashList` 虚拟化瀑布流与 URL 键控 `PixImage`。
- **完整客户端能力**：PKCE 安全登录与 Cookie 提取、探索（推荐/最新/Pixivision 特辑）、排行（自定义榜单与历史日期榜）、关注（动态/追更/好P友）、搜索（ID/链接直达、联想、高级布尔筛选）、画师主页/系列/标签页、多页插画与双指缩放浏览、Ugoira 动图逐帧播放与原生 MP4/GIF 导出、Manga OCR 汉化渲染、小说横排/竖排文库本 `PixWebView` 阅读（注音/着重号/标点悬挂/AI 摘要术语与原位译文/目录检索/离线书库）、CBZ/EPUB/TXT 导出、自定义 AI 与 Grok OAuth、SauceNAO 以图搜图及下载管理。
- **原 iOS 版配置导入**：
  - 支持直接从「设置 → 跨设备同步 → 从文件/剪贴板导入同步数据」导入 `Pix-Scripting-Sync-*.json`。
  - 登录前即可通过「导入 iOS 配置 / Token」或 Android 系统「分享」导入 `Pix-Scripting-Sync-*.json`、iCloud 目录原始 `settings.json` / `NovelReader/settings.json` / `novel_reader_settings.json` / `blocklist.json`、`CustomAIProfile` JSON、或整包 `Pix-Scripting.zip` 备份（含 `NovelTranslations` / `NovelOffline`），导入后立即刷新内存缓存，并支持直接使用 Pixiv Refresh Token 登录。
- **安全存储与签名**：登录令牌与 AI/SauceNAO 密钥通过 Android Keystore `AES/GCM/NoPadding` 加密持久化（含密钥失效自愈）；预览发布包使用固定证书（包名 `com.pixscripting.preview`）签发，支持 Obtainium 覆盖升级。

## 构建测试 APK（Debug）

本机构建使用 Node.js 22、JDK 17、Android SDK 35、Build Tools 35.0.0 与 Gradle 8.10.2：

```bash
npm ci
npm --prefix apps/android ci
npm --prefix apps/android run typecheck
node --test apps/android/tests/*.test.cjs
npm --prefix apps/android run bundle:check
(cd apps/android/android && bash ./gradlew :app:assembleDebug --no-daemon)
```

产物位于 `apps/android/android/app/build/outputs/apk/debug/app-debug.apk`（内置离线 JS Bundle）。

## 构建签名预览版（Release）

```bash
bash apps/android/build-preview.sh
```

脚本默认读取 `${MIRROR_ISLE_ANDROID_SIGNING_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mirror-isle-android-signing}/preview.p12`（别名 `mirror-isle-preview`）与 `preview.pass`，校验公钥 SHA-256 与 `apps/android/preview-cert.sha256` 一致后执行 `zipalign` 与 `apksigner` 签名，输出 `apps/android/dist/android-v<versionName>/Pix-Scripting-Android.apk` 与 `SHA256SUMS`。

## GitHub Actions CI/CD

- **CI（`.github/workflows/android-apk.yml`）**：在推送至 `feat/android-app` / `feat/android-*`、相关 PR 或手动触发时执行，运行 iOS 核心回归、语法检查、`typecheck`、Android 单元测试、Metro 离线打包校验与 `:app:assembleDebug`，并上传 `pix-scripting-android-debug-apk` 构建产物。
- **CD（`.github/workflows/android-release.yml`）**：在推送匹配 `android-v<versionName>` 的标签或手动触发时执行，需配置仓库 Secrets `ANDROID_SIGNING_P12_BASE64`（`preview.p12` 的 base64）与 `ANDROID_SIGNING_PASSWORD`（`preview.pass` 内容）；通过全量校验后调用 `apps/android/build-preview.sh`，上传签名预览产物并在标签触发时自动创建/更新 GitHub Prerelease（`--prerelease --latest=false`，不覆盖 iOS `Latest` 发布）。

## Obtainium 订阅建议

- 仓库 URL：`https://github.com/beckyeeky/Scripting`
- 开启 **Include prereleases**
- APK 过滤正则：`^Pix-Scripting-Android\.apk$`
- Tag 过滤正则：`android-v.+`
- 签名公钥 SHA-256：`17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`
