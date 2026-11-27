# Pix-Scripting Android 1.8.14.4-alpha.6

> [!NOTE]
> 本发布为 Android 预览频道 P2 收口版（`--prerelease`，`--latest=false`），可直接在 `alpha.4` / `alpha.5` 上覆盖升级，保留配置与登录态，不会覆盖 iOS `Latest` 发布（`v1.8.14.4-pixivreader`）。

## 本次更新

### 体积：约减半

- Release 只保留 `arm64-v8a` 与 `armeabi-v7a`，去掉 x86/x86_64 原生库。
- 开启 R8 混淆/裁剪与资源压缩，补齐 React Native、Hermes、WebView JS 桥、OkHttp、WorkManager 的 keep 规则；可用 `-PenableR8=false` 一键回滚。
- 实测 release APK：**23,156,612 字节**（alpha.5 为 49,406,815 字节，约 **-53%**）。
- Release 附件新增 `mapping.txt`，混淆后的崩溃栈可用它还原；`SHA256SUMS` 同时覆盖 APK 与 mapping。

### 隐私

- 设置「内容过滤与隐私 → 禁止截屏与后台预览」：开启后对 Activity 设 `FLAG_SECURE`，截屏、录屏与最近任务预览均被遮挡；冷启动与 Activity 重建后按已存设置恢复，OAuth 登录弹窗同样生效。默认关闭。

### 诊断

- 设置新增「导出诊断日志」：收集版本/构建号、系统版本、关键设置快照与最近 40 条 AI/HTTP/导航错误，递归脱敏 token、cookie、password、authorization、Bearer/JWT 及长密钥串后写入 JSON，经系统分享导出。分享前请自行确认内容。

### 导出目录

- 设置新增「自定义导出目录」：通过系统目录选择器（SAF）授权一个文件夹，EPUB/TXT/Ugoira MP4/GIF/ZIP/CBZ 等导出优先写入该目录，重名自动追加序号。
- 目录被删除或授权失效时会提示重新选择，并回退到原有分享/相册路径，不静默丢文件；可随时恢复默认。

## 回归与门禁

- 根测试 **235/235**；Android 测试 **134/134**（新增隐私遮罩、诊断脱敏、SAF 目录等用例）。
- CI `Build Android APK`：`46015144622` success；R8 release 构建用临时 tag 实际跑通 `assembleRelease`，再以正式 tag 发布。
- 语法检查 203 文件 0 错；`git diff --check` 干净。

## 签名与 Obtainium 配置

- **包名**：`com.pixscripting.preview`（`versionName = 1.8.14.4-alpha.6`，`versionCode = 6`）
- **签名证书 SHA-256**：`17de3888a127e14152e9c3f0e2bcfe7dbc93a4dde03352004afeb7f0a4f85795`
- **Release 附件**：`Pix-Scripting-Android.apk`、`SHA256SUMS`、`mapping.txt`

## 未验证

- 真机未验收：隐私遮罩的截屏/最近任务表现、诊断分享面板与文件内容、SAF 选目录/持久授权/写入与失效回退，均需设备复核。
- R8 混淆后的运行期行为（登录、WebView JS 桥、NativeModules、Ugoira/MediaCodec、前台下载服务）仅经构建验证，需真机冒烟；若遇崩溃请用随附 `mapping.txt` 还原栈。
- Release 不再支持 x86/x86_64：模拟器与 Chromebook 请使用 debug 包。
