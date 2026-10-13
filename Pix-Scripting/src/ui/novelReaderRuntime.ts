/**
 * 小说阅读器运行时（WebView 内注入的 DOM 侧定位逻辑 + TS 侧锚点换算）
 *
 * 为什么集中在一个模块：
 * 三套排版模板（沉浸横向 / 沉浸竖向 / 普通竖向）原先各自复制滚动与续读逻辑，
 * 续读锚点、图片迟加载校正、用户接管判定必须完全一致，否则「横/竖/沉浸」表现会分叉。
 *
 * 明确的约束（不要在这层实现）：
 * - 不发起网络请求；图片仍由 TS 侧注入。
 * - 不承诺 iOS 后台常驻；页面被系统回收后由 TS 侧重新载入并恢复锚点。
 */
import {
  createNovelAnchor,
  quoteFromText,
  resolveNovelAnchor,
  type AnchorChunkLike,
  type NovelReadingAnchor,
} from "../store/novelAnchor"

/**
 * 注入到 WebView 的 ES5 运行时源码。
 * 暴露 window.NovelReaderRuntime，供各模板脚本调用；纯 DOM 操作，无原生依赖。
 */
export const NOVEL_READER_RUNTIME_JS = `
var NovelReaderRuntime = (function () {
  var settling = false;
  var userTookOver = false;
  var programmaticUntil = 0;
  var highlighted = [];

  function now() { return Date.now ? Date.now() : new Date().getTime(); }
  function normalize(value) { return String(value == null ? "" : value).replace(/\\s+/g, " ").trim(); }
  function textOf(el) { if (!el) return ""; return el.innerText || el.textContent || ""; }

  function chunkElements() {
    try { return Array.prototype.slice.call(document.querySelectorAll("[data-chunk-id]")); }
    catch (e) { return []; }
  }

  function chunkElementById(id) {
    if (!id) return null;
    var el = document.getElementById ? document.getElementById(id) : null;
    if (el) return el;
    var all = chunkElements();
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute("data-chunk-id") === id) return all[i];
    }
    return null;
  }

  function subElements(el) {
    if (!el) return [];
    var list = [];
    try { list = Array.prototype.slice.call(el.querySelectorAll("p, .chapter-title, .novel-paragraph")); }
    catch (e) { list = []; }
    if (list.length === 0) { list = [el]; }
    return list;
  }

  /** 依据「视口读取线」计算块的段内偏移与可恢复文本锚点 */
  function computeAnchor(entryEl, readingTop) {
    if (!entryEl) return null;
    var chunkId = entryEl.getAttribute ? entryEl.getAttribute("data-chunk-id") : null;
    if (!chunkId) return null;
    var line = typeof readingTop === "number" ? readingTop : 0;
    var parts = subElements(entryEl);
    var offset = 0;
    var best = 0;
    var bestDistance = Infinity;
    for (var i = 0; i < parts.length; i++) {
      var rect = parts[i].getBoundingClientRect ? parts[i].getBoundingClientRect() : { top: 0 };
      var distance = Math.abs((rect && typeof rect.top === "number" ? rect.top : 0) - line);
      if (distance < bestDistance) { bestDistance = distance; best = offset; }
      offset += textOf(parts[i]).length + 1;
    }
    var text = textOf(entryEl);
    var start = Math.min(Math.max(0, best), Math.max(0, text.length - 1));
    var quote = "";
    if (text.length > 0) {
      while (start < text.length && /\\s/.test(text.charAt(start))) { start++; }
      quote = normalize(text.substr(start, 40));
    }
    return { chunkId: chunkId, offset: best, quote: quote };
  }

  /** 先按块 id，再按文本锚点在全文块中查找（正文或排版变化后的兜底） */
  function findElementForQuote(quote, preferredId) {
    var needle = normalize(quote);
    var preferred = chunkElementById(preferredId);
    if (!needle) return preferred;
    if (preferred && normalize(textOf(preferred)).indexOf(needle) >= 0) return preferred;
    var all = chunkElements();
    for (var i = 0; i < all.length; i++) {
      if (normalize(textOf(all[i])).indexOf(needle) >= 0) return all[i];
    }
    return preferred || null;
  }

  function markProgrammatic(duration) {
    programmaticUntil = now() + (typeof duration === "number" ? duration : 600);
  }
  function isProgrammatic() { return now() < programmaticUntil; }

  function scrollElementIntoView(el) {
    if (!el || typeof el.scrollIntoView !== "function") return false;
    markProgrammatic(600);
    try { el.scrollIntoView({ block: "start", inline: "start", behavior: "instant" }); return true; }
    catch (e) {
      try { el.scrollIntoView(true); return true; } catch (e2) { return false; }
    }
  }

  function clearHighlight() {
    for (var i = 0; i < highlighted.length; i++) {
      var node = highlighted[i];
      if (!node) continue;
      if (node.classList && node.classList.remove) node.classList.remove("novel-hit-para");
    }
    highlighted = [];
    var marks = [];
    try { marks = Array.prototype.slice.call(document.querySelectorAll("mark.novel-hit-mark")); }
    catch (e) { marks = []; }
    for (var j = 0; j < marks.length; j++) {
      var mark = marks[j];
      var parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) { parent.insertBefore(mark.firstChild, mark); }
      parent.removeChild(mark);
    }
  }

  /** 命中高亮：优先精确包裹命中的文本节点，失败时退化为段落级高亮 */
  function highlightQuote(el, quote) {
    clearHighlight();
    if (!el) return false;
    var needle = normalize(quote);
    var parts = subElements(el);
    var wrapped = false;
    for (var i = 0; i < parts.length && !wrapped; i++) {
      var part = parts[i];
      if (needle && normalize(textOf(part)).indexOf(needle) >= 0 &&
          typeof document.createTreeWalker === "function" && typeof document.createRange === "function") {
        try {
          var walker = document.createTreeWalker(part, 4, null, false);
          var node = walker.nextNode ? walker.nextNode() : null;
          while (node && !wrapped) {
            var raw = node.nodeValue || "";
            var at = normalize(raw).indexOf(needle) >= 0 ? raw.indexOf(needle) : -1;
            if (at < 0) {
              var normalized = normalize(raw);
              var normalizedAt = normalized.indexOf(needle);
              if (normalizedAt >= 0 && normalized.length > 0) { at = 0; }
            }
            if (at >= 0) {
              var range = document.createRange();
              range.setStart(node, at);
              range.setEnd(node, Math.min(raw.length, at + needle.length));
              var mark = document.createElement("mark");
              mark.className = "novel-hit-mark";
              range.surroundContents(mark);
              wrapped = true;
            }
            node = walker.nextNode ? walker.nextNode() : null;
          }
        } catch (e) { wrapped = false; }
      }
    }
    if (!wrapped && el.classList && el.classList.add) {
      el.classList.add("novel-hit-para");
      highlighted.push(el);
    }
    markProgrammatic(300);
    return true;
  }

  /** 目录/检索跳转：找块 → 滚动 → 高亮 → 进入「图片尚在加载」的待稳态 */
  function jumpToAnchor(payload) {
    var anchor = payload || {};
    var el = findElementForQuote(anchor.quote, anchor.chunkId);
    var matched = "start";
    if (el) {
      matched = anchor.chunkId && chunkIdMatches(el, anchor.chunkId) ? "chunk" : "quote";
    } else if (anchor.page && anchor.page > 1) {
      el = chunkElementById("page-" + anchor.page);
      if (el) matched = "page";
    }
    if (el) {
      scrollElementIntoView(el);
      if (anchor.quote) highlightQuote(el, anchor.quote);
      settling = true;
    }
    return { matched: matched, chunkId: el && el.getAttribute ? el.getAttribute("data-chunk-id") : null };
  }

  function chunkIdMatches(el, id) {
    if (!el || !el.getAttribute || !id) return false;
    return el.getAttribute("data-chunk-id") === id || el.id === id;
  }

  /** 图片迟加载：仅在待稳态且用户尚未接管时重新对齐，避免把续读位置推走 */
  function realignAfterContentChange(callback) {
    if (!settling || userTookOver) return false;
    if (typeof callback !== "function") return false;
    markProgrammatic(600);
    callback();
    return true;
  }

  function markUserTakeOver() {
    userTookOver = true;
    settling = false;
  }

  /** 滚动事件入口：程序化滚动不算用户接管 */
  function noteScroll() {
    if (isProgrammatic()) return false;
    markUserTakeOver();
    return true;
  }

  return {
    computeAnchor: computeAnchor,
    findElementForQuote: findElementForQuote,
    jumpToAnchor: jumpToAnchor,
    highlightQuote: highlightQuote,
    clearHighlight: clearHighlight,
    scrollElementIntoView: scrollElementIntoView,
    realignAfterContentChange: realignAfterContentChange,
    markUserTakeOver: markUserTakeOver,
    hasUserTakenOver: function () { return userTookOver; },
    setSettling: function (value) { settling = !!value; },
    isSettling: function () { return settling; },
    isProgrammatic: isProgrammatic,
    markProgrammatic: markProgrammatic,
    noteScroll: noteScroll,
    chunkElements: chunkElements,
    chunkElementById: chunkElementById,
    subElements: subElements,
    textOf: textOf,
    normalize: normalize
  };
})();
window.NovelReaderRuntime = NovelReaderRuntime;
`

/** 注入模板时使用的样式片段（命中高亮），与运行时逻辑配套 */
export const NOVEL_READER_RUNTIME_CSS = `
    mark.novel-hit-mark {
      background: rgba(255, 214, 10, 0.45);
      color: inherit;
      border-radius: 3px;
      padding: 0 1px;
    }
    .novel-hit-para {
      background: rgba(255, 214, 10, 0.22);
      border-radius: 6px;
      transition: background 0.25s ease;
    }
`

/**
 * WebView 上报的进度 → 阅读锚点（TS 侧换算）。
 * chunkText 传该块的**源正文**，因此 quote 与源文本一致，正文改动后仍可按原片段找回。
 */
export function anchorFromReaderMessage(
  message: {
    novelId?: number
    page?: number
    chunkId?: string
    offset?: number
    quote?: string
    chunkIndex?: number
  } | null | undefined,
  chunkText: string | null | undefined,
  contentVersion: string | null | undefined,
  novelIdFallback: number
): NovelReadingAnchor | null {
  if (!message) return null
  const page = typeof message.page === "number" && message.page > 0 ? message.page : 1
  const text = typeof chunkText === "string" ? chunkText : ""
  const reportedQuote = typeof message.quote === "string" ? message.quote.trim() : ""
  // 上报的偏移以 DOM 文本为准，这里换算到源正文的对应位置；文本锚点优先
  const located = reportedQuote && text ? locateQuoteForAnchor(text, reportedQuote) : -1
  const offset = located >= 0
    ? located
    : typeof message.offset === "number"
      ? message.offset
      : 0
  const quote = reportedQuote
    ? (located >= 0 ? quoteFromText(text, located) || reportedQuote : reportedQuote)
    : ""
  const anchor = createNovelAnchor({
    novelId: typeof message.novelId === "number" ? message.novelId : novelIdFallback,
    page,
    chunkId: message.chunkId,
    chunkIndex: message.chunkIndex,
    chunkText: text,
    contentVersion,
    offset,
  })
  if (quote) anchor.quote = quote
  return anchor
}

/** 在源正文中定位 WebView 上报的文本锚点；找不到返回 -1（由调用方回退到上报偏移） */
function locateQuoteForAnchor(text: string, quote: string): number {
  const direct = text.indexOf(quote)
  if (direct >= 0) return direct
  const normalized = quote.replace(/\s+/g, " ").trim()
  const normalizedText = text.replace(/\s+/g, " ")
  if (!normalized) return -1
  const at = normalizedText.indexOf(normalized)
  if (at < 0) return -1
  // 归一化位置映射回原始文本（空白折叠后的近似偏移）
  let count = 0
  let inSpace = false
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]
    const isSpace = /\s/.test(ch)
    if (isSpace) {
      if (inSpace) continue
      inSpace = true
    } else {
      inSpace = false
    }
    if (count === at) return index
    count++
  }
  return text.length
}

/**
 * 目标锚点 → WebView 指令载荷（跳转 + 高亮 + 恢复提示）。
 * matched 由纯逻辑预算，WebView 侧只负责滚动，不再自行判断。
 */
export function readerJumpPayload(
  anchor: NovelReadingAnchor | null | undefined,
  chunks: AnchorChunkLike[] | null | undefined,
  contentVersion?: string | null
): {
  chunkId: string | null
  page: number
  offset: number
  quote?: string
  matched: string
  contentChanged: boolean
  notice: string
} {
  const resolved = resolveNovelAnchor(anchor, chunks, { contentVersion: contentVersion ?? undefined })
  return {
    chunkId: resolved.chunkId,
    page: resolved.page,
    offset: resolved.offset,
    quote: resolved.quote,
    matched: resolved.matched,
    contentChanged: resolved.contentChanged,
    notice: "",
  }
}
