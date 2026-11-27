const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("../node_modules/typescript")

function loadTsModule(absPath, mocks = {}) {
  const source = fs.readFileSync(absPath, "utf8")
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
    fileName: absPath,
  }).outputText

  const mod = { exports: {} }
  const dir = path.dirname(absPath)

  function customRequire(specifier) {
    if (Object.prototype.hasOwnProperty.call(mocks, specifier)) {
      return mocks[specifier]
    }
    if (specifier.startsWith(".")) {
      const base = path.resolve(dir, specifier)
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return loadTsModule(candidate, mocks)
        }
      }
    }
    return require(specifier)
  }

  const fn = new Function("exports", "require", "module", "__filename", "__dirname", compiled)
  fn(mod.exports, customRequire, mod, absPath, dir)
  return mod.exports
}

const routeParserPath = path.resolve(__dirname, "../src/app/navigation/routeParser.ts")
const navContextPath = path.resolve(__dirname, "../src/app/navigation/NavContext.tsx")
const overlayHostPath = path.resolve(__dirname, "../src/app/overlay/OverlayHost.tsx")
const pixImagePath = path.resolve(__dirname, "../src/app/components/PixImage.tsx")
const illustCardPath = path.resolve(__dirname, "../src/app/components/IllustCard.tsx")

test("routeParser 解析 Pixiv URL、深链与全部标准路由", () => {
  const { parseRouteString, parseDeepLinkUrl, routeSignature } = loadTsModule(routeParserPath)

  assert.deepEqual(parseRouteString("123456"), { name: "illust", id: 123456 })
  assert.deepEqual(parseRouteString("https://www.pixiv.net/artworks/98765432"), {
    name: "illust",
    id: 98765432,
  })
  assert.deepEqual(parseRouteString("https://www.pixiv.net/novel/show.php?id=55511"), {
    name: "novel",
    id: 55511,
  })
  assert.deepEqual(parseRouteString("https://www.pixiv.net/users/4200"), {
    name: "user",
    id: 4200,
  })
  assert.deepEqual(parseRouteString("https://www.pixiv.net/novel/series/7788"), {
    name: "series",
    kind: "novel",
    id: 7788,
  })
  assert.deepEqual(parseRouteString("https://www.pixiv.net/user/10/series/9900"), {
    name: "series",
    kind: "manga",
    id: 9900,
  })
  assert.deepEqual(parseRouteString("pixivision:11223"), { name: "pixivision", id: 11223 })
  assert.deepEqual(parseRouteString("tag:%E5%88%9D%E9%9F%B3%E3%83%9F%E3%82%AF"), {
    name: "tagFeed",
    tag: "初音ミク",
    kind: "illust",
  })
  assert.deepEqual(parseRouteString("novelTag:SF"), {
    name: "tagFeed",
    tag: "SF",
    kind: "novel",
  })
  assert.deepEqual(parseRouteString("library:pixivision"), {
    name: "library",
    initialKind: "pixivision",
  })
  assert.deepEqual(parseRouteString("novelBookmarks"), { name: "novelLibrary" })
  assert.deepEqual(parseRouteString("downloadDetail:novels"), {
    name: "downloadManager",
    initialSection: "category",
    category: "novels",
  })
  assert.deepEqual(parseRouteString("customAISettings"), { name: "customAI" })
  assert.deepEqual(parseRouteString("blockedSettings"), { name: "blocklist" })

  assert.equal(parseDeepLinkUrl("pix-scripting://route/illust:888"), "illust:888")
  assert.equal(parseDeepLinkUrl("https://www.pixiv.net/en/artworks/444"), "illust:444")
  assert.equal(parseDeepLinkUrl("hello world"), null)

  assert.equal(routeSignature({ name: "illust", id: 42 }), "illust:42")
  assert.equal(routeSignature({ name: "series", kind: "novel", id: 9 }), "series:novel:9")
})

test("reduceBackAction 严格遵循：Overlay 优先 -> 仅弹当前 Tab 栈 -> 切回启动 Tab -> 退出", () => {
  const { reduceBackAction } = loadTsModule(navContextPath, {
    react: {
      createContext: () => ({ Provider: () => null }),
      useCallback: (fn) => fn,
      useContext: () => null,
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useRef: (v) => ({ current: v }),
      useState: (v) => [typeof v === "function" ? v() : v, () => {}],
    },
    "react-native": { BackHandler: { addEventListener: () => ({ remove: () => {} }) } },
    "../../../../../Pix-Scripting/src/image/imageLoader": { seedIllustFromPixivCache: () => {} },
    "../../../../../Pix-Scripting/src/store/routeNavigation": {
      registerTabNavigator: () => () => {},
      setActiveTabKind: () => {},
      setPixivRouteNavigator: () => () => {},
    },
    "../../../../../Pix-Scripting/src/store/settings": { loadSettings: () => ({ launchPage: "discovery" }) },
    "../../../../../Pix-Scripting/src/store/widgetStore": {
      seedIllustFromWidgetPool: () => {},
      seedPixivisionFromWidgetPool: () => {},
    },
  })

  const baseStacks = {
    discovery: [{ key: "d1", route: { name: "illust", id: 1 } }],
    ranking: [{ key: "r1", route: { name: "user", id: 2 } }],
    following: [],
    more: [],
    search: [],
  }

  // 1. Overlay open takes top priority and does not touch stacks
  const r1 = reduceBackAction(
    { activeTab: "discovery", launchTab: "discovery", stacks: baseStacks },
    () => true,
  )
  assert.deepEqual(r1, { handled: true, reason: "overlay" })

  // 2. Active tab has stack -> pops ONLY active tab; inactive ranking stack stays intact!
  const r2 = reduceBackAction(
    { activeTab: "discovery", launchTab: "discovery", stacks: baseStacks },
    () => false,
  )
  assert.equal(r2.handled, true)
  assert.equal(r2.reason, "pop")
  assert.equal(r2.tab, "discovery")
  assert.equal(r2.nextStacks.discovery.length, 0)
  assert.equal(r2.nextStacks.ranking.length, 1)

  // 3. Inactive tab has stack, active tab is empty -> MUST NOT pop inactive tab; switches to launchTab
  const r3 = reduceBackAction(
    { activeTab: "more", launchTab: "discovery", stacks: baseStacks },
    () => false,
  )
  assert.deepEqual(r3, { handled: true, reason: "switchTab", nextTab: "discovery" })

  // 4. Launch tab root with empty stack -> returns handled: false (allow Android exit)
  const r4 = reduceBackAction(
    {
      activeTab: "discovery",
      launchTab: "discovery",
      stacks: { ...baseStacks, discovery: [] },
    },
    () => false,
  )
  assert.deepEqual(r4, { handled: false, reason: "exit" })
})

test("OverlayHost 优先级解算与无 RN <Modal> 约束校验", () => {
  const { resolveTopOverlayDismissTarget } = loadTsModule(overlayHostPath, {
    react: {
      createContext: () => ({ Provider: () => null }),
      useCallback: (fn) => fn,
      useContext: () => null,
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useRef: (v) => ({ current: v }),
      useState: (v) => [v, () => {}],
    },
    "react-native": {
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      StyleSheet: { create: (s) => s, hairlineWidth: 0.5, absoluteFill: {}, absoluteFillObject: {} },
      Text: "Text",
      TextInput: "TextInput",
      View: "View",
    },
    "../../../../../Pix-Scripting/src/store/bookmarkSync": { onOpenBookmarkDetail: () => () => {} },
    "../../import/IosConfigImportModal": { IosConfigImportContent: () => null },
    "../../scripting/hostGlobals": { ScriptingDialog: {}, subscribeDialog: () => () => {} },
    "../theme/insets": { useSafeInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0, imeBottom: 0 }) },
    "../theme/ThemeProvider": { useAppTheme: () => ({ colors: {}, accent: "#007AFF" }) },
    "./BlockWorkSheet": { BlockWorkSheet: () => null },
    "./BookmarkDetailSheet": { BookmarkDetailSheet: () => null },
    "./CommentsSheet": { CommentsSheet: () => null },
  })

  assert.equal(
    resolveTopOverlayDismissTarget({ hasDialog: true, hasActionSheet: true, sheetCount: 2 }),
    "dialog",
  )
  assert.equal(
    resolveTopOverlayDismissTarget({ hasDialog: false, hasActionSheet: true, sheetCount: 2 }),
    "actionSheet",
  )
  assert.equal(
    resolveTopOverlayDismissTarget({ hasDialog: false, hasActionSheet: false, sheetCount: 1 }),
    "sheet",
  )
  assert.equal(
    resolveTopOverlayDismissTarget({ hasDialog: false, hasActionSheet: false, sheetCount: 0 }),
    "none",
  )

  // Assert zero RN <Modal> or SafeAreaView usage anywhere inside apps/android/src/app/** and App.tsx
  const appDir = path.resolve(__dirname, "../src/app")
  const filesToAudit = [
    path.resolve(__dirname, "../App.tsx"),
    path.resolve(__dirname, "../src/import/IosConfigImportModal.tsx"),
  ]
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) filesToAudit.push(full)
    }
  }
  walk(appDir)

  for (const file of filesToAudit) {
    const rawContent = fs.readFileSync(file, "utf8")
    const codeOnly = rawContent
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "")
    assert.equal(
      /<Modal\b/.test(codeOnly),
      false,
      `Forbidden RN <Modal> found in ${path.relative(path.resolve(__dirname, ".."), file)}`,
    )
    assert.equal(
      /<SafeAreaView\b/.test(codeOnly),
      false,
      `Forbidden RN <SafeAreaView> found in ${path.relative(path.resolve(__dirname, ".."), file)}`,
    )
  }
})

test("clampedAspectRatio 与 computeIllustCardHeight 返回确定性高度", () => {
  const rnStub = {
    ActivityIndicator: "ActivityIndicator",
    Image: "Image",
    Pressable: "Pressable",
    StyleSheet: { create: (s) => s, hairlineWidth: 0.5, absoluteFill: {}, absoluteFillObject: {} },
    Text: "Text",
    View: "View",
  }
  const { clampedAspectRatio, resolveUrlKeyedPath } = loadTsModule(pixImagePath, {
    react: { useEffect: () => {}, useState: (v) => [typeof v === "function" ? v() : v, () => {}] },
    "react-native": rnStub,
    "../../../../../Pix-Scripting/src/image/imageLoader": {
      cachedFilePath: () => null,
      DEFAULT_IMAGE_PRIORITY: 999999,
      loadImage: async () => null,
    },
    "../../scripting/hostGlobals": {
      ScriptingFileManager: { removeSync: () => {} },
    },
    "../theme/ThemeProvider": { useAppTheme: () => ({ colors: {}, accent: "#007AFF", accentSoft: "#007AFF22" }) },
  })

  assert.equal(clampedAspectRatio(1000, 1000), 1)
  assert.equal(clampedAspectRatio(100, 5000), 0.55)
  assert.equal(clampedAspectRatio(5000, 100), 2.0)
  assert.equal(clampedAspectRatio(0, 0), 0.85)

  // Recycled FlashList cell moving from urlA -> urlB must NEVER render urlA's stale path
  assert.equal(
    resolveUrlKeyedPath(
      "https://i.pximg.net/b.jpg",
      null,
      { url: "https://i.pximg.net/a.jpg", path: "/cache/a.jpg", retryToken: 0 },
      0,
    ),
    null,
  )
  // Recycled cell with urlB already cached synchronously uses syncPath immediately
  assert.equal(
    resolveUrlKeyedPath(
      "https://i.pximg.net/b.jpg",
      "/cache/b.jpg",
      { url: "https://i.pximg.net/a.jpg", path: "/cache/a.jpg", retryToken: 0 },
      0,
    ),
    "/cache/b.jpg",
  )
  // Retry token > 0 ignores stale disk syncPath until fresh download completes
  assert.equal(
    resolveUrlKeyedPath(
      "https://i.pximg.net/b.jpg",
      "/cache/corrupt-b.jpg",
      { url: "https://i.pximg.net/b.jpg", path: null, retryToken: 1 },
      1,
    ),
    null,
  )
  // Matching URL and retryToken resolves the freshly downloaded path
  assert.equal(
    resolveUrlKeyedPath(
      "https://i.pximg.net/b.jpg",
      null,
      { url: "https://i.pximg.net/b.jpg", path: "/cache/fresh-b.jpg", retryToken: 1 },
      1,
    ),
    "/cache/fresh-b.jpg",
  )

  // Verify effectiveBottomInset sums bottom + imeBottom (never max)
  const insetsPath = path.resolve(__dirname, "../src/app/theme/insets.ts")
  const { effectiveBottomInset } = loadTsModule(insetsPath, {
    react: { createContext: () => ({ Provider: "Provider" }), createElement: () => null, useContext: () => ({}), useEffect: () => {}, useState: (v) => [v, () => {}] },
    "react-native": {
      DeviceEventEmitter: { addListener: () => ({ remove() {} }) },
      Keyboard: { addListener: () => ({ remove() {} }) },
      NativeModules: {},
      Platform: { OS: "android" },
      StatusBar: { currentHeight: 24 },
    },
  })
  assert.equal(effectiveBottomInset({ bottom: 48, imeBottom: 0 }), 48)
  assert.equal(effectiveBottomInset({ bottom: 48, imeBottom: 280 }), 328)
  assert.equal(effectiveBottomInset({ bottom: 24, imeBottom: 300 }), 324)

  const { computeIllustCardHeight, ILLUST_CARD_META_HEIGHT } = loadTsModule(illustCardPath, {
    react: { memo: (c) => c, useEffect: () => {}, useState: (v) => [v, () => {}] },
    "react-native": rnStub,
    "../../../../../Pix-Scripting/src/api/pixiv": { addBookmark: async () => {}, removeBookmark: async () => {} },
    "../../../../../Pix-Scripting/src/api/session": { session: {} },
    "../../../../../Pix-Scripting/src/image/imageLoader": { cardThumbUrlOf: () => null },
    "../../../../../Pix-Scripting/src/platform/haptics": { triggerHaptic: () => {} },
    "../../../../../Pix-Scripting/src/store/bookmarkSync": {
      getCachedIllustBookmark: () => undefined,
      onIllustBookmarkChanged: () => () => {},
    },
    "../overlay/OverlayHost": { useOverlay: () => ({}) },
    "../theme/ThemeProvider": { useAppTheme: () => ({ colors: {}, settings: {} }) },
    "./PixImage": { clampedAspectRatio, PixImage: () => null },
  })

  const hCompact = computeIllustCardHeight({ width: 1000, height: 1500 }, 180, true)
  const hFull = computeIllustCardHeight({ width: 1000, height: 1500 }, 180, false)
  assert.equal(hCompact, 270)
  assert.equal(hFull, 270 + ILLUST_CARD_META_HEIGHT)
})

test("Android 原生界面全量渲染烟测：LoginScreen、AppShell 与全部 20+ 核心页面渲染不抛错", () => {
  const Module = require("node:module")
  const React = require("../node_modules/react")
  const origResolve = Module._resolveFilename
  const origTsExt = require.extensions[".ts"]
  const origTsxExt = require.extensions[".tsx"]
  const tmpDoc = fs.mkdtempSync("/tmp/pix-android-native-smoke-")
  const scriptingIndex = path.resolve(__dirname, "../src/scripting/index.ts")
  const androidRoot = path.resolve(__dirname, "..")
  const repoRoot = path.resolve(__dirname, "../../..")
  const loadedKeys = new Set()

  function makeComp(name) {
    const c = React.forwardRef((props, ref) =>
      React.createElement(name, { ...props, ref }, props && props.children),
    )
    c.displayName = name
    return c
  }

  function makeListComp(name) {
    const c = React.forwardRef((props, ref) => {
      const children = []
      if (props && props.ListHeaderComponent) {
        children.push(
          typeof props.ListHeaderComponent === "function"
            ? React.createElement(props.ListHeaderComponent, { key: "__hdr" })
            : props.ListHeaderComponent,
        )
      }
      const data = Array.isArray(props && props.data) ? props.data : []
      if (data.length > 0 && typeof props.renderItem === "function") {
        data.slice(0, 2).forEach((item, index) => {
          children.push(
            React.createElement(
              React.Fragment,
              { key: `__item_${index}` },
              props.renderItem({ item, index }),
            ),
          )
        })
      } else if (props && props.ListEmptyComponent) {
        children.push(
          typeof props.ListEmptyComponent === "function"
            ? React.createElement(props.ListEmptyComponent, { key: "__empty" })
            : props.ListEmptyComponent,
        )
      }
      if (props && props.ListFooterComponent) {
        children.push(
          typeof props.ListFooterComponent === "function"
            ? React.createElement(props.ListFooterComponent, { key: "__ftr" })
            : props.ListFooterComponent,
        )
      }
      return React.createElement(name, { ...props, ref }, children)
    })
    c.displayName = name
    return c
  }

  class AnimatedValue {
    constructor(val = 0) {
      this._value = val
    }
    setValue(v) {
      this._value = v
    }
    interpolate() {
      return this
    }
  }

  const Animated = {
    Value: AnimatedValue,
    ValueXY: class {
      constructor(v = { x: 0, y: 0 }) {
        this.x = new AnimatedValue(v.x)
        this.y = new AnimatedValue(v.y)
      }
      setValue() {}
      getLayout() {
        return {}
      }
      getTranslateTransform() {
        return []
      }
    },
    View: makeComp("Animated.View"),
    Image: makeComp("Animated.Image"),
    Text: makeComp("Animated.Text"),
    ScrollView: makeComp("Animated.ScrollView"),
    timing: () => ({ start: (cb) => cb && cb({ finished: true }), stop: () => {} }),
    spring: () => ({ start: (cb) => cb && cb({ finished: true }), stop: () => {} }),
    parallel: () => ({ start: (cb) => cb && cb({ finished: true }), stop: () => {} }),
    sequence: () => ({ start: (cb) => cb && cb({ finished: true }), stop: () => {} }),
    event: () => () => {},
  }

  const rnMock = {
    ActivityIndicator: makeComp("ActivityIndicator"),
    Alert: { alert: () => {} },
    Animated,
    Appearance: { getColorScheme: () => "light", addChangeListener: () => ({ remove: () => {} }) },
    AppState: { addEventListener: () => ({ remove: () => {} }), currentState: "active" },
    BackHandler: { addEventListener: () => ({ remove: () => {} }), exitApp: () => {} },
    DeviceEventEmitter: { addListener: () => ({ remove: () => {} }) },
    Dimensions: {
      get: () => ({ width: 412, height: 915, scale: 2.625, fontScale: 1 }),
      addEventListener: () => ({ remove: () => {} }),
    },
    FlatList: makeListComp("FlatList"),
    Image: Object.assign(makeComp("RNImage"), {
      getSize: (_u, ok) => ok && ok(600, 800),
      prefetch: async () => true,
    }),
    Keyboard: {
      addListener: () => ({ remove: () => {} }),
      dismiss: () => {},
    },
    KeyboardAvoidingView: makeComp("KeyboardAvoidingView"),
    LayoutAnimation: { configureNext: () => {}, Presets: { easeInEaseOut: {} } },
    Linking: {
      openURL: async () => {},
      canOpenURL: async () => true,
      getInitialURL: async () => null,
      addEventListener: () => ({ remove: () => {} }),
    },
    Modal: makeComp("Modal"),
    NativeEventEmitter: class {
      addListener() {
        return { remove() {} }
      }
    },
    NativeModules: {
      PixFileSystem: {
        getDirectoriesSync: () => ({
          documents: tmpDoc,
          cache: tmpDoc,
          temp: tmpDoc,
          appGroup: tmpDoc,
          icloud: tmpDoc,
        }),
        storageContainsSync: () => false,
        storageGetSync: () => null,
        storageSetSync: () => true,
        storageRemoveSync: () => true,
        keychainGetSync: () => null,
        keychainSetSync: () => true,
        keychainRemoveSync: () => true,
        fsExistsSync: (p) => fs.existsSync(p),
        fsIsDirectorySync: (p) => {
          try {
            return fs.statSync(p).isDirectory()
          } catch {
            return false
          }
        },
        fsIsFileSync: (p) => {
          try {
            return fs.statSync(p).isFile()
          } catch {
            return false
          }
        },
        fsMkdirSync: (p) => {
          fs.mkdirSync(p, { recursive: true })
          return true
        },
        fsReadStringSync: (p) => fs.readFileSync(p, "utf8"),
        fsWriteStringSync: (p, c) => {
          fs.mkdirSync(path.dirname(p), { recursive: true })
          fs.writeFileSync(p, c, "utf8")
          return true
        },
        fsReadBase64Sync: (p) => fs.readFileSync(p).toString("base64"),
        fsWriteBase64Sync: (p, b) => {
          fs.mkdirSync(path.dirname(p), { recursive: true })
          fs.writeFileSync(p, Buffer.from(b, "base64"))
          return true
        },
        fsReaddirSync: (p) => {
          try {
            return fs.readdirSync(p)
          } catch {
            return []
          }
        },
        fsStatSync: (p) => {
          const st = fs.statSync(p)
          return {
            size: st.size,
            mtimeMs: st.mtimeMs,
            modificationDate: st.mtimeMs,
            isDirectory: st.isDirectory(),
            isFile: st.isFile(),
          }
        },
        fsRemoveSync: (p) => {
          fs.rmSync(p, { recursive: true, force: true })
          return true
        },
        fsCopySync: (f, t) => {
          fs.copyFileSync(f, t)
          return true
        },
        fsRenameSync: (f, t) => {
          fs.renameSync(f, t)
          return true
        },
        randomBytesBase64Sync: (n) => Buffer.alloc(n || 32, 7).toString("base64"),
      },
      PixHttp: {
        request: async () => ({ status: 200, headers: {}, bodyText: "{}" }),
        streamRequest: async () => ({ status: 200, headers: {} }),
        abortRequest: () => {},
      },
      PixImageMedia: {
        imageBoundsSync: () => ({ width: 600, height: 800 }),
        imagePaletteSync: () => null,
        saveToGallery: async () => true,
      },
      PixSystemBridge: {
        getInitialIntent: async () => null,
        clearIntent: async () => true,
        triggerHaptic: () => {},
        getAppMetadataSync: () => ({
          applicationId: "com.pixscripting.preview",
          versionName: "1.8.14.4-alpha.4",
          versionCode: 4,
        }),
        getWindowInsetsSync: () => ({ top: 28, bottom: 24, left: 0, right: 0, imeBottom: 0 }),
        setSystemBarStyle: () => {},
        presentOAuthWebView: async () => ({ url: "" }),
        shareItems: async () => true,
        pickDocument: async () => null,
      },
    },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    PixelRatio: { get: () => 2.625, roundToNearestPixel: (v) => Math.round(v) },
    Platform: { OS: "android", Version: 34, select: (o) => o.android ?? o.default },
    Pressable: makeComp("Pressable"),
    RefreshControl: makeComp("RefreshControl"),
    ScrollView: makeComp("RNScrollView"),
    SectionList: makeListComp("SectionList"),
    Share: { share: async () => ({ action: "sharedAction" }) },
    StatusBar: Object.assign(makeComp("StatusBar"), { currentHeight: 28 }),
    StyleSheet: {
      create: (s) => s,
      hairlineWidth: 0.5,
      absoluteFill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
      absoluteFillObject: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
      flatten: (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s || {}),
    },
    Switch: makeComp("Switch"),
    Text: makeComp("RNText"),
    TextInput: makeComp("TextInput"),
    TouchableOpacity: makeComp("TouchableOpacity"),
    UIManager: {
      getViewManagerConfig: () => ({ Commands: { evaluateJS: 1 } }),
      dispatchViewManagerCommand: () => {},
    },
    View: makeComp("View"),
    findNodeHandle: () => 1,
    processColor: () => -65536,
    requireNativeComponent: (n) => makeComp(n),
    useColorScheme: () => "light",
    useWindowDimensions: () => ({ width: 412, height: 915, scale: 2.625, fontScale: 1 }),
  }

  const flashListMock = {
    FlashList: makeListComp("FlashList"),
    MasonryFlashList: makeListComp("MasonryFlashList"),
  }

  try {
    Module._resolveFilename = function (req, parent, isMain, opts) {
      if (req === "react-native") return "__rn_android_smoke_mock__"
      if (req === "@shopify/flash-list") return "__flash_list_smoke_mock__"
      if (req === "scripting") return scriptingIndex
      if (req === "react" || req.startsWith("react/")) {
        return origResolve.call(
          this,
          req,
          { ...parent, paths: [path.resolve(androidRoot, "node_modules")] },
          isMain,
          opts,
        )
      }
      if (req.startsWith(".") && parent && parent.filename) {
        const base = path.resolve(path.dirname(parent.filename), req)
        for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
          if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext
        }
      }
      return origResolve.call(this, req, parent, isMain, opts)
    }
    require.cache["__rn_android_smoke_mock__"] = {
      id: "__rn_android_smoke_mock__",
      filename: "__rn_android_smoke_mock__",
      loaded: true,
      exports: rnMock,
    }
    require.cache["__flash_list_smoke_mock__"] = {
      id: "__flash_list_smoke_mock__",
      filename: "__flash_list_smoke_mock__",
      loaded: true,
      exports: flashListMock,
    }

    for (const ext of [".ts", ".tsx"]) {
      require.extensions[ext] = (mod, filename) => {
        loadedKeys.add(filename)
        const src = fs.readFileSync(filename, "utf8")
        const out = ts.transpileModule(src, {
          fileName: filename,
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        })
        mod._compile(out.outputText, filename)
      }
    }

    require(path.resolve(androidRoot, "src/scripting/polyfills.ts"))
    const { installHostGlobals } = require(path.resolve(androidRoot, "src/scripting/hostGlobals.ts"))
    installHostGlobals()

    const { session } = require(path.resolve(repoRoot, "Pix-Scripting/src/api/session.ts"))
    session.applyResponse(
      {
        access_token: "smoke_access_token",
        refresh_token: "smoke_refresh_token",
        expires_in: 3600,
        user: {
          id: "424242",
          name: "AndroidTester",
          account: "android_tester",
          is_premium: true,
          profile_image_urls: { px_170x170: "https://s.pximg.net/common/images/no_profile.png" },
        },
      },
      null,
    )

    const { InsetsProvider } = require(path.resolve(androidRoot, "src/app/theme/insets.ts"))
    const { ThemeProvider } = require(path.resolve(androidRoot, "src/app/theme/ThemeProvider.tsx"))
    const { NavProvider } = require(path.resolve(androidRoot, "src/app/navigation/NavContext.tsx"))
    const { OverlayProvider } = require(path.resolve(androidRoot, "src/app/overlay/OverlayHost.tsx"))
    const { AppShell } = require(path.resolve(androidRoot, "src/app/navigation/AppShell.tsx"))
    const { LoginScreen } = require(path.resolve(androidRoot, "src/app/screens/LoginScreen.tsx"))
    const feeds = require(path.resolve(androidRoot, "src/app/features/feeds/index.ts"))
    const media = require(path.resolve(androidRoot, "src/app/features/media/index.ts"))
    const novel = require(path.resolve(androidRoot, "src/app/features/novel/index.ts"))
    const account = require(path.resolve(androidRoot, "src/app/features/account/index.ts"))

    const Internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
    const prevDispatcher = Internals.ReactCurrentDispatcher.current
    Internals.ReactCurrentDispatcher.current = {
      useState: (init) => [typeof init === "function" ? init() : init, () => {}],
      useReducer: (_r, init, initFn) => [typeof initFn === "function" ? initFn(init) : init, () => {}],
      useEffect: () => {},
      useLayoutEffect: () => {},
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useRef: (v) => ({ current: v }),
      useContext: (ctx) => ctx._currentValue,
      useSyncExternalStore: (_sub, get) => get(),
      useImperativeHandle: () => {},
      useInsertionEffect: () => {},
      useDebugValue: () => {},
      useDeferredValue: (v) => v,
      useTransition: () => [false, (fn) => fn()],
      useId: () => ":smoke:",
    }

    let renderedNodes = 0
    function walkElement(el, depth = 0) {
      if (depth > 80) return
      if (el == null || typeof el === "boolean" || typeof el === "string" || typeof el === "number") return
      if (Array.isArray(el)) {
        for (const child of el) walkElement(child, depth + 1)
        return
      }
      if (typeof el !== "object" || !el.type) return
      renderedNodes++
      if (typeof el.type === "symbol") {
        walkElement(el.props && el.props.children, depth + 1)
        return
      }
      if (typeof el.type === "object") {
        if (el.type.$$typeof === Symbol.for("react.provider")) {
          const prev = el.type._context._currentValue
          el.type._context._currentValue = el.props.value
          try {
            walkElement(el.props.children, depth + 1)
          } finally {
            el.type._context._currentValue = prev
          }
          return
        }
        if (el.type.$$typeof === Symbol.for("react.forward_ref")) {
          walkElement(el.type.render(el.props || {}, el.ref), depth + 1)
          return
        }
        if (el.type.$$typeof === Symbol.for("react.memo")) {
          walkElement(React.createElement(el.type.type, el.props), depth + 1)
          return
        }
      }
      if (typeof el.type === "function") {
        if (el.type.prototype && el.type.prototype.isReactComponent) {
          const inst = new el.type(el.props || {})
          walkElement(inst.render(), depth + 1)
        } else {
          walkElement(el.type(el.props || {}), depth + 1)
        }
        return
      }
      if (el.props && el.props.children) {
        walkElement(el.props.children, depth + 1)
      }
    }

    function renderInProviders(element) {
      walkElement(
        React.createElement(
          InsetsProvider,
          null,
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(
              NavProvider,
              { dismissTopOverlay: () => false },
              React.createElement(OverlayProvider, null, element),
            ),
          ),
        ),
      )
    }

    const sampleUser = {
      id: 99,
      name: "SmokeArtist",
      account: "smoke_artist",
      profile_image_urls: { medium: "https://i.pximg.net/u.jpg" },
      is_followed: false,
    }
    const sampleIllust = {
      id: 101,
      title: "Smoke Illust",
      type: "illust",
      image_urls: {
        square_medium: "https://i.pximg.net/sq.jpg",
        medium: "https://i.pximg.net/m.jpg",
        large: "https://i.pximg.net/l.jpg",
      },
      caption: "Hello <b>Pixiv</b>",
      user: sampleUser,
      tags: [{ name: "風景", translated_name: "风景" }],
      create_date: "2026-01-01T00:00:00+09:00",
      page_count: 2,
      width: 1000,
      height: 1400,
      x_restrict: 0,
      series: null,
      meta_single_page: {},
      meta_pages: [
        { image_urls: { large: "https://i.pximg.net/p0.jpg", original: "https://i.pximg.net/p0_orig.jpg" } },
        { image_urls: { large: "https://i.pximg.net/p1.jpg", original: "https://i.pximg.net/p1_orig.jpg" } },
      ],
      total_view: 1200,
      total_bookmarks: 320,
      is_bookmarked: false,
      is_muted: false,
      illust_ai_type: 1,
      total_comments: 5,
      comment_access_control: 0,
    }
    const sampleNovel = {
      id: 202,
      title: "Smoke Novel",
      caption: "Novel caption",
      user: sampleUser,
      tags: [{ name: "SF", translated_name: "科幻" }],
      create_date: "2026-01-01T00:00:00+09:00",
      page_count: 2,
      x_restrict: 0,
      total_view: 500,
      total_bookmarks: 80,
      is_bookmarked: false,
      is_muted: false,
      novel_ai_type: 1,
      total_comments: 3,
      text_length: 9000,
      visible: true,
      series: { id: 77, title: "Smoke Series" },
      image_urls: { medium: "https://i.pximg.net/nm.jpg", large: "https://i.pximg.net/nl.jpg" },
    }
    const sampleArticle = {
      id: 303,
      title: "Smoke Pixivision",
      imageURL: "https://i.pximg.net/pv.jpg",
      date: "2026-01-01",
      category: "插画",
      tags: [{ id: 1, name: "特集" }],
    }

    try {
      const screenCases = [
        ["LoginScreen", React.createElement(LoginScreen, {})],
        ["AppShell", React.createElement(AppShell, {})],
        ["DiscoveryScreen", React.createElement(feeds.DiscoveryScreen, {})],
        ["RankingScreen", React.createElement(feeds.RankingScreen, {})],
        ["FollowFeedScreen", React.createElement(feeds.FollowFeedScreen, {})],
        ["SearchScreen", React.createElement(feeds.SearchScreen, {})],
        ["IllustDetailScreen", React.createElement(media.IllustDetailScreen, { illustID: 101, seed: sampleIllust })],
        ["IllustGalleryScreen", React.createElement(media.IllustGalleryScreen, { illust: sampleIllust, initialPage: 0 })],
        ["UserDetailScreen", React.createElement(media.UserDetailScreen, { userID: 99, seed: sampleUser })],
        ["PixivisionDetailScreen", React.createElement(media.PixivisionDetailScreen, { articleID: 303, seed: sampleArticle })],
        ["SeriesDetailScreen(manga)", React.createElement(media.SeriesDetailScreen, { kind: "manga", seriesID: 55 })],
        ["SeriesDetailScreen(novel)", React.createElement(media.SeriesDetailScreen, { kind: "novel", seriesID: 77 })],
        ["TagFeedScreen(illust)", React.createElement(media.TagFeedScreen, { tag: "風景", kind: "illust" })],
        ["NovelDetailScreen", React.createElement(novel.NovelDetailScreen, { novelID: 202, seed: sampleNovel })],
        [
          "NovelReaderScreen",
          React.createElement(novel.NovelReaderScreen, {
            name: "novelReader",
            novelId: 202,
            title: "Smoke Novel",
            rawText: "[chapter:序章]\n正文内容[newpage]第二页内容",
          }),
        ],
        ["NovelLibraryScreen", React.createElement(novel.NovelLibraryScreen, {})],
        ["MoreScreen", React.createElement(account.MoreScreen, {})],
        ["LibraryScreen", React.createElement(account.LibraryScreen, { initialKind: "illustration" })],
        ["HistoryScreen", React.createElement(account.HistoryScreen, {})],
        ["HistoryAnalyticsScreen", React.createElement(account.HistoryAnalyticsScreen, { initialScope: "all" })],
        ["DownloadManagerScreen", React.createElement(account.DownloadManagerScreen, { initialSection: "overview" })],
        ["SettingsScreen", React.createElement(account.SettingsScreen, {})],
        ["CustomAISettingsScreen", React.createElement(account.CustomAISettingsScreen, {})],
        ["BlocklistScreen", React.createElement(account.BlocklistScreen, {})],
        ["AboutScreen", React.createElement(account.AboutScreen, {})],
      ]

      for (const [label, el] of screenCases) {
        try {
          renderInProviders(el)
        } catch (err) {
          assert.fail(`Screen ${label} threw during render: ${err && err.stack ? err.stack : err}`)
        }
      }
      assert.ok(renderedNodes > 200, `Expected full render walk (>200 nodes), got ${renderedNodes}`)
    } finally {
      Internals.ReactCurrentDispatcher.current = prevDispatcher
    }
  } finally {
    Module._resolveFilename = origResolve
    delete require.cache["__rn_android_smoke_mock__"]
    delete require.cache["__flash_list_smoke_mock__"]
    for (const key of loadedKeys) {
      delete require.cache[key]
    }
    require.extensions[".ts"] = origTsExt
    require.extensions[".tsx"] = origTsxExt
    fs.rmSync(tmpDoc, { recursive: true, force: true })
  }
})
