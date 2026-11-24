const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const vm = require("node:vm")
const ts = require("typescript")

function loadModule(file, mocks = {}, globals = {}) {
  const absolute = path.join(__dirname, "..", file)
  const source = fs.readFileSync(absolute, "utf8")
  const js = ts.transpileModule(source, {
    fileName: absolute,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(
    js,
    {
      module,
      exports: module.exports,
      console: { log() {}, warn() {}, error() {} },
      JSON,
      Date,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      Set,
      Map,
      RegExp,
      Error,
      Promise,
      setTimeout,
      clearTimeout,
      require(id) {
        if (!(id in mocks)) throw new Error(`缺少测试替身：${id}`)
        return mocks[id]
      },
      ...globals,
    },
    { filename: absolute }
  )
  return module.exports
}

function createDeviceEnv({ userID = 1001, isiCloudEnabled = false, iCloudRoot = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cross-sync-"))
  const cloudRoot = iCloudRoot || `${root}-icloud`
  const FileManager = {
    documentsDirectory: root,
    iCloudDocumentsDirectory: cloudRoot,
    appGroupDocumentsDirectory: `${root}-group`,
    temporaryDirectory: `${root}-tmp`,
    isiCloudEnabled,
    existsSync: (p) => fs.existsSync(p),
    createDirectorySync: (p) => fs.mkdirSync(p, { recursive: true }),
    readAsStringSync: (p) => fs.readFileSync(p, "utf8"),
    writeAsStringSync: (p, c) => fs.writeFileSync(p, c, "utf8"),
    readDirectorySync: (p) => fs.readdirSync(p),
    statSync: (p) => ({ size: fs.statSync(p).size }),
    removeSync: (p) => fs.rmSync(p, { recursive: true, force: true }),
    renameSync: (from, to) => fs.renameSync(from, to),
    isDirectorySync: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
    copyFileSync: (from, to) => fs.copyFileSync(from, to),
    isFileStoredIniCloud: (p) => Boolean(isiCloudEnabled && p.startsWith(cloudRoot)),
    isiCloudFileDownloaded: () => true,
    downloadFileFromiCloud: async () => true,
  }

  const globals = {
    FileManager,
    Storage: {
      contains: () => false,
      get: () => null,
      remove: () => {},
    },
  }

  const sessionMock = { session: { userID, currentGeneration: 1 } }
  const scriptingMock = { Device: { isiPad: false } }
  const safeFile = loadModule("Pix-Scripting/src/store/safeFile.ts", {}, globals)
  const dataDirectory = loadModule(
    "Pix-Scripting/src/store/dataDirectory.ts",
    {
      "../api/session": sessionMock,
      "./safeFile": safeFile,
    },
    globals
  )

  const settings = loadModule(
    "Pix-Scripting/src/store/settings.ts",
    {
      scripting: scriptingMock,
      "../ui/feedColumns": {},
      "./dataDirectory": dataDirectory,
      "./safeFile": safeFile,
    },
    globals
  )

  const novelReaderSettings = loadModule(
    "Pix-Scripting/src/store/novelReaderSettings.ts",
    {
      "./dataDirectory": dataDirectory,
      "./safeFile": safeFile,
    },
    globals
  )

  const blocklist = loadModule(
    "Pix-Scripting/src/store/blocklist.ts",
    {
      "./dataDirectory": dataDirectory,
      "./safeFile": safeFile,
      "../api/session": sessionMock,
    },
    globals
  )

  const pixivisionBookmarks = loadModule(
    "Pix-Scripting/src/store/pixivisionBookmarks.ts",
    {
      "./dataDirectory": dataDirectory,
      "./safeFile": safeFile,
      "../api/session": sessionMock,
    },
    globals
  )

  const historySyncStub = {
    notifyLocalMutation: () => {},
    recordClearBefore: () => {},
    recordTombstone: () => {},
    recordSearchTombstone: () => {},
    removeSearchTombstone: () => {},
    recordSearchClearBefore: () => {},
    syncHistoryNow: async () => true,
  }

  const novelProgress = loadModule(
    "Pix-Scripting/src/store/novelProgress.ts",
    {
      "./dataDirectory": dataDirectory,
      "./safeFile": safeFile,
      "../api/session": sessionMock,
      "./historySync": historySyncStub,
    },
    globals
  )

  const history = loadModule(
    "Pix-Scripting/src/store/history.ts",
    {
      "./settings": settings,
      "./dataDirectory": dataDirectory,
      "./safeFile": safeFile,
      "./novelProgress": novelProgress,
      "../api/session": sessionMock,
      "./historySync": historySyncStub,
    },
    globals
  )

  const searchHistory = loadModule(
    "Pix-Scripting/src/store/searchHistory.ts",
    {
      "./dataDirectory": dataDirectory,
      "./safeFile": safeFile,
      "../api/session": sessionMock,
      "./historySync": historySyncStub,
    },
    globals
  )

  const historySync = loadModule(
    "Pix-Scripting/src/store/historySync.ts",
    {
      "./dataDirectory": dataDirectory,
      "./safeFile": safeFile,
      "../api/session": sessionMock,
      "./history": history,
      "./novelProgress": novelProgress,
      "./searchHistory": searchHistory,
    },
    globals
  )

  const crossDeviceSync = loadModule(
    "Pix-Scripting/src/store/crossDeviceSync.ts",
    {
      "./dataDirectory": dataDirectory,
      "./history": history,
      "./historySync": historySync,
      "./novelProgress": novelProgress,
      "./searchHistory": searchHistory,
      "./settings": settings,
      "./novelReaderSettings": novelReaderSettings,
      "./blocklist": blocklist,
      "./pixivisionBookmarks": pixivisionBookmarks,
    },
    globals
  )

  return {
    root,
    cloudRoot,
    FileManager,
    settings,
    novelReaderSettings,
    blocklist,
    pixivisionBookmarks,
    novelProgress,
    history,
    searchHistory,
    historySync,
    crossDeviceSync,
  }
}

test("跨设备导出与导入：同步程序设置、阅读器设置、历史记录、小说进度、搜索记录与屏蔽列表", () => {
  const deviceA = createDeviceEnv({ userID: 2001, isiCloudEnabled: false })
  const deviceB = createDeviceEnv({ userID: 2001, isiCloudEnabled: false })

  // 设备 A 配置设置与数据
  deviceA.settings.updateSettings({
    showR18: true,
    pageLayout: "classic",
    downloadCustomDirectoryBookmark: "deviceA_bookmark",
    downloadCustomDirectoryPath: "/deviceA/dir",
  })
  deviceA.novelReaderSettings.replaceNovelReaderSettings({
    fontSize: 22,
    layoutDirection: "vertical",
    translationTargetLanguage: "zh-TW",
  })
  deviceA.history.replaceKindEntries(
    "illustration",
    [
      {
        kind: "illust",
        viewedAt: 2000,
        illustration: {
          id: 101,
          title: "Illust A",
          type: "illust",
          user: { id: 10, name: "Author A" },
          image_urls: { medium: "https://example.com/a.jpg" },
        },
      },
    ],
    true
  )
  deviceA.novelProgress.replaceNovelProgressMap(
    new Map([
      [
        501,
        {
          novelID: 501,
          currentPage: 5,
          totalPages: 10,
          updatedAt: 3000,
        },
      ],
    ]),
    true
  )
  deviceA.searchHistory.replaceSearchHistoryStore(
    {
      illust: [{ query: "miku", searchedAt: 2500 }],
      novel: [{ query: "fantasy", searchedAt: 2600 }],
      user: [],
    },
    true
  )
  deviceA.blocklist.blockTag("spoiler")
  deviceA.blocklist.blockUser({ id: 99, name: "BlockedUser" })
  deviceA.pixivisionBookmarks.addPixivisionBookmark({
    id: 777,
    title: "特集 777",
    bookmarkedAt: 4000,
  })

  // 设备 B 预先存在自己的本地目录书签、较旧的同一条进度、以及另一条历史记录
  deviceB.settings.updateSettings({
    showR18: false,
    downloadCustomDirectoryBookmark: "deviceB_local_bookmark",
    downloadCustomDirectoryPath: "/deviceB/local",
  })
  deviceB.history.replaceKindEntries(
    "illustration",
    [
      {
        kind: "illust",
        viewedAt: 1500,
        illustration: {
          id: 102,
          title: "Illust B",
          type: "illust",
          user: { id: 20, name: "Author B" },
          image_urls: { medium: "https://example.com/b.jpg" },
        },
      },
    ],
    true
  )
  deviceB.novelProgress.replaceNovelProgressMap(
    new Map([
      [
        501,
        {
          novelID: 501,
          currentPage: 2,
          totalPages: 10,
          updatedAt: 1000,
        },
      ],
    ]),
    true
  )
  deviceB.blocklist.blockTag("existingTag")

  const exportedJson = deviceA.crossDeviceSync.exportCrossDeviceSnapshotJson()
  const parsed = JSON.parse(exportedJson)
  // 安全校验：不导出设备本地目录书签
  assert.equal(parsed.appSettings.downloadCustomDirectoryBookmark, null)
  assert.equal(parsed.appSettings.downloadCustomDirectoryPath, null)

  const summary = deviceB.crossDeviceSync.importCrossDeviceSnapshot(exportedJson)
  assert.equal(summary.appliedAppSettings, true)
  assert.equal(summary.appliedReaderSettings, true)
  assert.equal(summary.mergedHistoryItems.illustration, 1)
  assert.equal(summary.mergedNovelProgress, 1)
  assert.equal(summary.mergedSearchHistory, 2)
  assert.equal(summary.addedBlockedTags, 1)
  assert.equal(summary.addedBlockedUsers, 1)
  assert.equal(summary.mergedPixivisionBookmarks, 1)

  // 验证设备 B 设置已更新，但保留设备 B 的本地下载目录书签
  const bSettings = deviceB.settings.loadSettings()
  assert.equal(bSettings.showR18, true)
  assert.equal(bSettings.pageLayout, "classic")
  assert.equal(bSettings.downloadCustomDirectoryBookmark, "deviceB_local_bookmark")
  assert.equal(bSettings.downloadCustomDirectoryPath, "/deviceB/local")

  // 验证阅读器设置
  const bReader = deviceB.novelReaderSettings.loadNovelReaderSettings()
  assert.equal(bReader.fontSize, 22)
  assert.equal(bReader.layoutDirection, "vertical")
  assert.equal(bReader.translationTargetLanguage, "zh-TW")

  // 验证历史合并（保留两条，按时间倒序）
  const bIllustHistory = deviceB.history.loadKindEntries("illustration")
  assert.equal(bIllustHistory.length, 2)
  assert.equal(bIllustHistory[0].illustration.id, 101)
  assert.equal(bIllustHistory[1].illustration.id, 102)

  // 验证小说进度取较新的第 5 页
  const bProgress = deviceB.novelProgress.getAllNovelProgressMap().get(501)
  assert.equal(bProgress.currentPage, 5)

  // 验证屏蔽列表合并（保留原有 + 新增）
  const bBlocklist = deviceB.blocklist.loadBlocklist()
  assert.deepEqual(bBlocklist.blockedTags.sort(), ["existingTag", "spoiler"])
  assert.equal(bBlocklist.blockedUsers.length, 1)
  assert.equal(bBlocklist.blockedUsers[0].id, 99)

  // 验证 Pixivision 收藏
  const bBookmarks = deviceB.pixivisionBookmarks.loadPixivisionBookmarks()
  assert.equal(bBookmarks.length, 1)
  assert.equal(bBookmarks[0].id, 777)
})

test("iCloud 跨设备同步：远端更新设置、阅读器设置、屏蔽列表与特辑收藏后可热重载并通知订阅者", async () => {
  const sharedCloudRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cross-icloud-"))
  const deviceA = createDeviceEnv({ userID: 3001, isiCloudEnabled: true, iCloudRoot: sharedCloudRoot })
  const deviceB = createDeviceEnv({ userID: 3001, isiCloudEnabled: true, iCloudRoot: sharedCloudRoot })

  // 设备 B 先加载到内存缓存
  assert.equal(deviceB.settings.loadSettings().showAI, false)
  assert.equal(deviceB.novelReaderSettings.loadNovelReaderSettings().fontSize, 17)
  assert.equal(deviceB.blocklist.loadBlocklist().blockedTags.length, 0)
  assert.equal(deviceB.pixivisionBookmarks.loadPixivisionBookmarks().length, 0)

  let settingsNotified = 0
  let readerNotified = 0
  let blocklistNotified = 0
  deviceB.settings.onSettingsChanged(() => settingsNotified++)
  deviceB.novelReaderSettings.onNovelReaderSettingsChanged(() => readerNotified++)
  deviceB.blocklist.onBlocklistChanged(() => blocklistNotified++)

  // 设备 A 修改配置写入共享 iCloud 目录
  deviceA.settings.updateSettings({ showAI: true, colorScheme: "dark" })
  deviceA.novelReaderSettings.replaceNovelReaderSettings({ fontSize: 24 })
  deviceA.blocklist.blockTag("ai-spam")
  deviceA.pixivisionBookmarks.addPixivisionBookmark({
    id: 888,
    title: "Cloud Feature",
    bookmarkedAt: 5000,
  })

  // 设备 B 触发全量同步
  const res = await deviceB.crossDeviceSync.syncAllCrossDeviceDataNow()
  assert.equal(res.ok, true)
  assert.equal(res.icloudEnabled, true)
  assert.equal(res.settingsReloaded, true)
  assert.equal(res.readerSettingsReloaded, true)
  assert.equal(res.blocklistReloaded, true)
  assert.equal(res.pixivisionBookmarksReloaded, true)

  assert.equal(deviceB.settings.loadSettings().showAI, true)
  assert.equal(deviceB.settings.loadSettings().colorScheme, "dark")
  assert.equal(deviceB.novelReaderSettings.loadNovelReaderSettings().fontSize, 24)
  assert.deepEqual(deviceB.blocklist.loadBlocklist().blockedTags, ["ai-spam"])
  assert.equal(deviceB.pixivisionBookmarks.loadPixivisionBookmarks()[0].id, 888)
  assert.ok(settingsNotified >= 1)
  assert.ok(readerNotified >= 1)
  assert.ok(blocklistNotified >= 1)
  assert.ok(deviceB.crossDeviceSync.getCrossDeviceSyncOverview().lastSyncTime > 0)
})

test("未开启 iCloud 时立即同步返回明确提示；导入非法数据包时抛出清晰错误", async () => {
  const device = createDeviceEnv({ userID: 4001, isiCloudEnabled: false })
  const res = await device.crossDeviceSync.syncAllCrossDeviceDataNow()
  assert.equal(res.ok, false)
  assert.equal(res.icloudEnabled, false)
  assert.match(res.error, /未开启 iCloud/)

  assert.throws(
    () => device.crossDeviceSync.parseCrossDeviceSnapshot("{not-json"),
    /有效的 JSON/
  )
  assert.throws(
    () => device.crossDeviceSync.parseCrossDeviceSnapshot(JSON.stringify({ format: "other", schemaVersion: 1 })),
    /Pix-Scripting/
  )
  assert.throws(
    () =>
      device.crossDeviceSync.parseCrossDeviceSnapshot(
        JSON.stringify({ format: "pix-scripting-sync", schemaVersion: 99 })
      ),
    /不支持的同步数据版本/
  )
})
