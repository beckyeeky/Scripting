const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

test("SF_SYMBOL_MAP 覆盖 Pix-Scripting 中全部静态 systemName / systemImage 图标", () => {
  const pixRoot = path.resolve(__dirname, "../../../Pix-Scripting")
  const sfSource = fs.readFileSync(path.resolve(__dirname, "../src/scripting/sfSymbols.tsx"), "utf8")

  const definedSymbols = new Set()
  for (const m of sfSource.matchAll(/["']?([a-z0-9.]+)["']?\s*:\s*["']/g)) {
    definedSymbols.add(m[1])
  }

  const usedSymbols = new Set()
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const txt = fs.readFileSync(full, "utf8")
        for (const m of txt.matchAll(/system(?:Name|Image)\s*[:=]\s*"([a-z0-9.]+)"/g)) {
          usedSymbols.add(m[1])
        }
      }
    }
  }
  walk(pixRoot)

  const missing = [...usedSymbols].filter((sym) => !definedSymbols.has(sym))
  assert.deepEqual(missing, [], `Missing SF Symbols in sfSymbols.tsx: ${missing.join(", ")}`)
})

test("Android scripting/index.ts 导出 Pix-Scripting 所需全部符号", () => {
  const pixRoot = path.resolve(__dirname, "../../../Pix-Scripting")
  const indexSrc = fs.readFileSync(path.resolve(__dirname, "../src/scripting/index.ts"), "utf8")

  const needed = new Set()
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        const txt = fs.readFileSync(full, "utf8")
        for (const m of txt.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']scripting["']/g)) {
          for (const part of m[1].split(",")) {
            let sym = part.trim()
            if (sym.startsWith("type ")) sym = sym.slice(5).trim()
            sym = sym.split(" as ")[0].trim()
            if (sym) needed.add(sym)
          }
        }
      }
    }
  }
  walk(pixRoot)

  const missingExports = [...needed].filter((sym) => !new RegExp(`\\b${sym}\\b`).test(indexSrc))
  assert.deepEqual(missingExports, [], `Missing scripting exports: ${missingExports.join(", ")}`)
})

test("登录后开启玻璃自定义与实验氛围光时 RootView、5 个 Tab、卡片与氛围光完整渲染不抛错", () => {
  const Module = require("node:module")
  const ts = require("../node_modules/typescript")
  const React = require("../node_modules/react")
  const origResolve = Module._resolveFilename
  const origTsExt = require.extensions[".ts"]
  const origTsxExt = require.extensions[".tsx"]
  const tmpDoc = fs.mkdtempSync("/tmp/pix-render-test-")
  const scriptingIndex = path.resolve(__dirname, "../src/scripting/index.ts")

  function makeComp(name) {
    const c = React.forwardRef((props, ref) => React.createElement(name, { ...props, ref }, props.children))
    c.displayName = name
    return c
  }
  const rnMock = {
    ActivityIndicator: makeComp("ActivityIndicator"),
    Appearance: { getColorScheme: () => "light", addChangeListener: () => ({ remove: () => {} }) },
    AppState: { addEventListener: () => ({ remove: () => {} }), currentState: "active" },
    BackHandler: { addEventListener: () => ({ remove: () => {} }), exitApp: () => {} },
    DeviceEventEmitter: { addListener: () => ({ remove: () => {} }) },
    Dimensions: {
      get: () => ({ width: 412, height: 915, scale: 2.625 }),
      addEventListener: () => ({ remove: () => {} }),
    },
    Image: makeComp("RNImage"),
    LayoutAnimation: { configureNext: () => {}, Presets: { easeInEaseOut: {} } },
    Linking: { openURL: async () => {} },
    Modal: makeComp("Modal"),
    NativeEventEmitter: class { addListener() { return { remove() {} } } },
    NativeModules: {
      PixFileSystem: {
        getDirectoriesSync: () => ({ documents: tmpDoc, cache: tmpDoc, temp: tmpDoc, appGroup: tmpDoc, icloud: tmpDoc }),
        storageContainsSync: () => false,
        storageGetSync: () => null,
        storageSetSync: () => true,
        storageRemoveSync: () => true,
        keychainGetSync: () => null,
        keychainSetSync: () => true,
        keychainRemoveSync: () => true,
        fsExistsSync: (p) => fs.existsSync(p),
        fsIsDirectorySync: (p) => { try { return fs.statSync(p).isDirectory() } catch { return false } },
        fsIsFileSync: (p) => { try { return fs.statSync(p).isFile() } catch { return false } },
        fsMkdirSync: (p) => { fs.mkdirSync(p, { recursive: true }); return true },
        fsReadStringSync: (p) => fs.readFileSync(p, "utf8"),
        fsWriteStringSync: (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, "utf8"); return true },
        fsReadBase64Sync: (p) => fs.readFileSync(p).toString("base64"),
        fsWriteBase64Sync: (p, b) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(b, "base64")); return true },
        fsReaddirSync: (p) => { try { return fs.readdirSync(p) } catch { return [] } },
        fsStatSync: (p) => { const st = fs.statSync(p); return { size: st.size, mtimeMs: st.mtimeMs, modificationDate: st.mtimeMs, isDirectory: st.isDirectory(), isFile: st.isFile() } },
        fsRemoveSync: (p) => { fs.rmSync(p, { recursive: true, force: true }); return true },
        fsCopySync: (f, t) => { fs.copyFileSync(f, t); return true },
        fsRenameSync: (f, t) => { fs.renameSync(f, t); return true },
      },
      PixHttp: { request: async () => ({ status: 200, headers: {}, bodyText: "{}" }), abortRequest: () => {} },
      PixImageMedia: { imageBoundsSync: () => ({ width: 600, height: 800 }), imagePaletteSync: () => null },
      PixSystemBridge: { getInitialIntent: async () => null, clearIntent: async () => true, triggerHaptic: () => {} },
    },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Platform: { OS: "android", Version: 34, select: (o) => o.android ?? o.default },
    Pressable: makeComp("Pressable"),
    RefreshControl: makeComp("RefreshControl"),
    SafeAreaView: makeComp("SafeAreaView"),
    ScrollView: makeComp("RNScrollView"),
    StatusBar: makeComp("StatusBar"),
    StyleSheet: { create: (s) => s, hairlineWidth: 0.5, flatten: (s) => s },
    Switch: makeComp("Switch"),
    Text: makeComp("RNText"),
    TextInput: makeComp("TextInput"),
    TouchableOpacity: makeComp("TouchableOpacity"),
    UIManager: { getViewManagerConfig: () => ({}) },
    View: makeComp("View"),
    processColor: () => -65536,
    requireNativeComponent: (n) => makeComp(n),
    useColorScheme: () => "light",
    useWindowDimensions: () => ({ width: 412, height: 915, scale: 2.625, fontScale: 1 }),
  }

  try {
    Module._resolveFilename = function(req, parent, isMain, opts) {
      if (req === "react-native") return "__rn_render_mock__"
      if (req === "scripting") return scriptingIndex
      if (req === "react" || req.startsWith("react/")) {
        return origResolve.call(this, req, { ...parent, paths: [path.resolve(__dirname, "../node_modules")] }, isMain, opts)
      }
      if (req.startsWith(".") && parent && parent.filename) {
        const base = path.resolve(path.dirname(parent.filename), req)
        for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"]) {
          if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext
        }
      }
      return origResolve.call(this, req, parent, isMain, opts)
    }
    require.cache["__rn_render_mock__"] = { id: "__rn_render_mock__", filename: "__rn_render_mock__", loaded: true, exports: rnMock }

    for (const ext of [".ts", ".tsx"]) {
      require.extensions[ext] = (mod, filename) => {
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

    require("../src/scripting/polyfills.ts")
    const { installHostGlobals, ScriptingUIGlass } = require("../src/scripting/hostGlobals.ts")
    installHostGlobals()

    const g1 = ScriptingUIGlass.regular().tint("rgba(255,0,0,0.2)").interactive(true)
    const g2 = ScriptingUIGlass.clear().tint("#007AFF").interactive(false)
    assert.equal(g1.tintColor, "rgba(255,0,0,0.2)")
    assert.equal(g1.isInteractive, true)
    assert.equal(g2.style, "clear")
    assert.equal(g2.isInteractive, false)

    const { session } = require("../../../Pix-Scripting/src/api/session.ts")
    session.applyResponse({
      access_token: "test_access",
      refresh_token: "test_refresh",
      expires_in: 3600,
      user: {
        id: "12345",
        name: "Tester",
        account: "tester",
        is_premium: true,
        x_restrict: 2,
        profile_image_urls: { px_170x170: "https://s.pximg.net/common/images/no_profile.png" },
      },
    }, null)

    const { updateSettings } = require("../../../Pix-Scripting/src/store/settings.ts")
    updateSettings({
      glassCustomTintEnabled: true,
      glassTintColor: "#FF2D55",
      glassInteractive: true,
      ambientImmersion: true,
      experimentalImmersion: true,
      experimentalImmersionAlgorithm: "geminiA",
    })

    const Internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
    const prevDispatcher = Internals.ReactCurrentDispatcher.current
    Internals.ReactCurrentDispatcher.current = {
      useState: (init) => [typeof init === "function" ? init() : init, () => {}],
      useReducer: (r, init) => [init, () => {}],
      useEffect: () => {},
      useLayoutEffect: () => {},
      useCallback: (fn) => fn,
      useMemo: (fn) => fn(),
      useRef: (v) => ({ current: v }),
      useContext: (ctx) => ctx._currentValue,
      useSyncExternalStore: (sub, get) => get(),
    }

    function walkElement(el) {
      if (el == null || typeof el === "boolean" || typeof el === "string" || typeof el === "number") return
      if (Array.isArray(el)) { el.forEach(walkElement); return }
      if (typeof el !== "object" || !el.type) return
      if (typeof el.type === "symbol") { walkElement(el.props && el.props.children); return }
      if (typeof el.type === "object") {
        if (el.type.$$typeof === Symbol.for("react.provider")) {
          const prev = el.type._context._currentValue
          el.type._context._currentValue = el.props.value
          walkElement(el.props.children)
          el.type._context._currentValue = prev
          return
        }
        if (el.type.$$typeof === Symbol.for("react.forward_ref")) {
          walkElement(el.type.render(el.props, el.ref))
          return
        }
        if (el.type.$$typeof === Symbol.for("react.memo")) {
          walkElement(React.createElement(el.type.type, el.props))
          return
        }
      }
      if (typeof el.type === "function") {
        walkElement(el.type(el.props || {}))
        return
      }
      if (el.props && el.props.children) walkElement(el.props.children)
    }

    try {
      const { RootView } = require("../../../Pix-Scripting/src/ui/appRoot.tsx")
      const { TAB_CONTENT_DEFS } = require("../../../Pix-Scripting/src/ui/TabShellShared.tsx")
      const { SplitShell } = require("../../../Pix-Scripting/src/ui/SplitShell.tsx")
      const { IllustFlowFeed } = require("../../../Pix-Scripting/src/ui/components/IllustFlowFeed.tsx")
      const { NovelCard } = require("../../../Pix-Scripting/src/ui/components/NovelCard.tsx")
      const { renderAmbientBackground } = require("../../../Pix-Scripting/src/ui/ambient/renderAmbientBackground.tsx")

      walkElement(React.createElement(RootView, {}))
      walkElement(React.createElement(SplitShell, { onClose: () => {} }))
      for (const tab of TAB_CONTENT_DEFS) {
        walkElement(tab.renderRoot({ onClose: () => {} }))
      }

      const sampleIllust = {
        id: 101,
        title: "Test Illust",
        type: "illust",
        image_urls: { square_medium: "https://i.pximg.net/sq.jpg", medium: "https://i.pximg.net/m.jpg", large: "https://i.pximg.net/l.jpg" },
        caption: "Hello",
        restrict: 0,
        user: { id: 99, name: "Artist", account: "artist", profile_image_urls: { medium: "https://i.pximg.net/u.jpg" }, is_followed: false },
        tags: [{ name: "風景", translated_name: "风景" }],
        tools: [],
        create_date: "2026-01-01T00:00:00+09:00",
        page_count: 2,
        width: 1000,
        height: 1400,
        sanity_level: 2,
        x_restrict: 0,
        series: null,
        meta_single_page: {},
        meta_pages: [],
        total_view: 1000,
        total_bookmarks: 200,
        is_bookmarked: false,
        visible: true,
        is_muted: false,
        illust_ai_type: 1,
        illust_book_style: 0,
      }
      const sampleNovel = {
        id: 202,
        title: "Test Novel",
        caption: "Novel desc",
        restrict: 0,
        x_restrict: 0,
        is_original: true,
        image_urls: { square_medium: "https://i.pximg.net/nsq.jpg", medium: "https://i.pximg.net/nm.jpg", large: "https://i.pximg.net/nl.jpg" },
        create_date: "2026-01-01T00:00:00+09:00",
        tags: [{ name: "ファンタジー", translated_name: "奇幻" }],
        page_count: 5,
        text_length: 12000,
        user: { id: 99, name: "Author", account: "author", profile_image_urls: { medium: "https://i.pximg.net/u.jpg" }, is_followed: false },
        series: { id: 2, title: "Novel Series" },
        is_bookmarked: false,
        total_bookmarks: 50,
        total_view: 500,
        visible: true,
        total_comments: 3,
        is_muted: false,
        is_mypixiv_only: false,
        is_x_restricted: false,
        novel_ai_type: 1,
      }
      walkElement(React.createElement(IllustFlowFeed, { items: [sampleIllust], hasMore: true, onLoadMore: () => {}, enableHeroFirst: true }))
      walkElement(React.createElement(NovelCard, { novel: sampleNovel }))

      const palette = {
        topColor: "#336699",
        midColor: "#224466",
        backgroundColor: "#112233",
        ultimateLeadingColor: "#4477AA",
        ultimatePrismColor: "#5588BB",
        ultimateTrailingColor: "#6699CC",
        ultimateMidColor: "#224466",
        ultimateBgColor: "#112233",
        exploreAccentColor: "#77AADD",
        exploreTopColor: "#336699",
        exploreMidColor: "#224466",
        exploreBgColor: "#112233",
      }
      for (const alg of ["classic", "explore", "ultimate", "transcend", "geminiA", "geminiB"]) {
        walkElement(renderAmbientBackground({ ambientPalette: palette, ambientAlgorithm: alg, isDark: false, ambientIntensity: "medium", active: true }))
      }
    } finally {
      Internals.ReactCurrentDispatcher.current = prevDispatcher
    }
  } finally {
    Module._resolveFilename = origResolve
    delete require.cache["__rn_render_mock__"]
    require.extensions[".ts"] = origTsExt
    require.extensions[".tsx"] = origTsxExt
    fs.rmSync(tmpDoc, { recursive: true, force: true })
  }
})
