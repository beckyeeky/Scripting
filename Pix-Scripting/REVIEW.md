# 分批审查与回归记录

## 基线

全项目 TypeScript 诊断：8 项。补齐 `OfflineImageTask.deferred?: boolean` 后为 4 项，无新增错误；该批只改类型声明，无运行行为改变。

## 本轮行为修复范围

- 下载队列：排队任务暂停后恢复，应重新进入 queued，由调度器启动；已启动的任务继续原 runner。
- 氛围色：渲染阶段 getter 只读取内存，不同步解码磁盘图片；保留已有异步补全路径。

两项行为修复均已完成。合并后再次全项目诊断仍为上述 4 项既有错误，无新增错误。

### 下载调度回归

新增 `src/downloader/downloadTaskManager.pauseResume.isolated.test.ts`，执行通过：debounce-queued、queued-pause-resume、queued-resumed-schedulable、debounce-running、running-resume、done。A/B 各只启动一次，排队恢复不占用执行槽，已运行恢复不重启 runner，600ms 防抖保留。

为测试增加了默认关闭的隔离实例及后台任务注入接口。隔离实例不写任务目录、不启动灵动岛，但模块导入时生产单例仍会初始化，令牌仍可能读取信号文件，所以并非完全无原生副作用的沙箱。

### 氛围色回归

新增 `src/image/colorExtractor.renderCache.regression.tsx`，执行输出 `RENDER_CACHE_REGRESSION_OK`。验证 getter 不解码、本地图片异步提取后可从内存命中、相同 URL 并发只解码一次、显式同步提取仍可用。只修改 colorExtractor getter，useIllustAmbient 已有异步补全，无需改动。

### 验证边界

未跑真实网络下载、灵动岛按钮或完整 UI。氛围色改动避免渲染期间同步解码，并不意味着把解码迁到后台线程，也没有实测帧率提升。冷缓存首帧可能先使用默认配色。用户色盘 getter 的同步解码以及缓存容量上限本轮未改。

建议设备回归：① A 下载中将 B 暂停再恢复，观察 A 完成后 B 启动；② A 自身暂停等待超过 600ms 后恢复；③ 冷色盘、热图片缓存进入详情，确认默认背景随后更新为氛围色；④ 快速切换作品，检查配色没有串页。静态检查和隔离测试不等于真实网络、原生 UI 端到端验证。

## 后续优先检查（本轮未修改）

1. `downloadHelper.ts` / 导出器：区分暂停导致的 abort 与用户取消，避免恢复后把在途图片记作永久失败。需要受控下载服务验证。
2. `NovelReader.tsx`：HTML 完成加载后是否重放已缓存插图，避免注入旧文档后丢图。需要真实 WebView 延迟加载测试。
3. `Hooks.tsx`：分页等待动画期间改变过滤条件，是否发布旧缓冲；尾项消费标记的提前返回分支是否可靠复位。
4. `bottomAccessory.tsx`：详情请求返回后是否覆盖用户刚修改的追更状态，需要取消守卫及状态版本保护。
5. `UserDetailPage.tsx`：标签 effect 与 loadDetail 均调用 fetchUserWorkTags；用户切换时需要缓存隔离及旧请求取消。
6. `search.tsx`：热门标签并发请求需要序号保护，避免旧失败覆盖新成功。
7. `client.ts`：OAuth token 请求涉及一次性凭证，重试策略需要独立评估；不能仅凭 HTTP 5xx 就保证重放安全。
8. `history.ts`：大历史数组复制与整文件持久化值得测量。不要直接改成共享数组原地更新，以免破坏快照语义；id→index 索引也会因 unshift/splice 需要重建，并非自然获得 O(1) 更新。

## 剩余基线类型诊断

- NovelDetail / NovelImmersiveReader：PixivNovel 与 PixivNovelDetail 的 content 要求不一致。
- NovelOutlineSearchSheet：Element 被传给只接受基本类型的位置。
- NovelReader：清理回调中的 controllerSink 可能 undefined。

这些问题本轮不通过类型断言强行消除，需分别确认运行时契约。
