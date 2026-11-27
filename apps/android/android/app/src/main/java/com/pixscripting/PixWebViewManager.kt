package com.pixscripting

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Build
import android.view.MotionEvent
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.RCTEventEmitter

internal const val PIX_WEBVIEW_BASE_URL = "https://appassets.pixscripting.local/"
private const val COMMAND_EVALUATE_JS = 1
private const val MAX_PENDING_EVALS = 200

internal const val WEBKIT_SHIM_JS = """
(function() {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.__pixProxy) return;
  var bridge = window.__PixAndroidWebBridge;
  if (!bridge) return;
  var handlers = new Proxy({}, {
    get: function(_target, prop) {
      if (prop === '__pixProxy') return true;
      var name = String(prop);
      return {
        postMessage: function(payload) {
          try {
            bridge.postMessage(name, JSON.stringify(payload === undefined ? null : payload));
          } catch (e) {}
        }
      };
    }
  });
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = handlers;
})();
"""

class PixManagedWebView(private val themedContext: ThemedReactContext) : WebView(themedContext) {
  var currentGeneration: Int = 0
  private var pageLoadedGeneration: Int = -1
  private var lastAppliedHtmlKey: String = ""
  private var lastPropEvalId: Int = 0
  private val pendingEvals = ArrayDeque<Pair<Int, String>>()
  private var destroyed = false

  init {
    configureWebView(this)
    addJavascriptInterface(object {
      @JavascriptInterface
      fun postMessage(name: String, jsonPayload: String) {
        val event = Arguments.createMap().apply {
          putString("name", name)
          putString("payload", jsonPayload)
          putInt("generation", currentGeneration)
        }
        post {
          if (!destroyed && themedContext.hasActiveReactInstance()) {
            themedContext
              .getJSModule(RCTEventEmitter::class.java)
              .receiveEvent(id, "topScriptMessage", event)
          }
        }
      }
    }, "__PixAndroidWebBridge")

    webViewClient = object : WebViewClient() {
      override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        if (destroyed) return
        view?.evaluateJavascript(WEBKIT_SHIM_JS, null)
        pageLoadedGeneration = currentGeneration
        flushPendingEvals()
        if (themedContext.hasActiveReactInstance()) {
          val event = Arguments.createMap().apply {
            putInt("generation", currentGeneration)
            putBoolean("success", true)
          }
          themedContext
            .getJSModule(RCTEventEmitter::class.java)
            .receiveEvent(id, "topLoadComplete", event)
        }
      }

      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val targetUrl = request?.url?.toString() ?: return false
        return handleExternalNavigation(targetUrl)
      }

      @Deprecated("Deprecated in Java")
      override fun shouldOverrideUrlLoading(view: WebView?, targetUrl: String?): Boolean {
        if (targetUrl == null) return false
        return handleExternalNavigation(targetUrl)
      }

      override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
        pageLoadedGeneration = -1
        pendingEvals.clear()
        if (!destroyed && themedContext.hasActiveReactInstance()) {
          val event = Arguments.createMap().apply {
            putInt("generation", currentGeneration)
            putBoolean("success", false)
            putBoolean("crashed", true)
          }
          themedContext
            .getJSModule(RCTEventEmitter::class.java)
            .receiveEvent(id, "topLoadComplete", event)
        }
        return true
      }
    }
  }

  private fun handleExternalNavigation(targetUrl: String): Boolean {
    if (targetUrl.startsWith(PIX_WEBVIEW_BASE_URL)) return false
    if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://") || targetUrl.startsWith("pixiv://")) {
      val payloadJson = org.json.JSONObject().put("url", targetUrl).toString()
      if (!destroyed && themedContext.hasActiveReactInstance()) {
        val event = Arguments.createMap().apply {
          putString("name", "openLink")
          putString("payload", payloadJson)
          putInt("generation", currentGeneration)
        }
        themedContext
          .getJSModule(RCTEventEmitter::class.java)
          .receiveEvent(id, "topScriptMessage", event)
      }
      return true
    }
    return false
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(event: MotionEvent?): Boolean {
    if (event != null) {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
          parent?.requestDisallowInterceptTouchEvent(true)
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          parent?.requestDisallowInterceptTouchEvent(false)
        }
      }
    }
    return super.onTouchEvent(event)
  }

  private fun emitEvalResult(evalId: Int, rawResult: String?) {
    if (destroyed || !themedContext.hasActiveReactInstance()) return
    val event = Arguments.createMap().apply {
      putInt("evalId", evalId)
      if (rawResult != null) putString("result", rawResult) else putNull("result")
    }
    themedContext
      .getJSModule(RCTEventEmitter::class.java)
      .receiveEvent(id, "topEvalResult", event)
  }

  private fun flushPendingEvals() {
    while (pendingEvals.isNotEmpty() && !destroyed) {
      val (evalId, script) = pendingEvals.removeFirst()
      evaluateJavascript(script) { res -> emitEvalResult(evalId, res) }
    }
  }

  fun enqueueOrEvalJs(evalId: Int, script: String) {
    if (destroyed) return
    if (currentGeneration <= 0 || pageLoadedGeneration != currentGeneration) {
      if (pendingEvals.size >= MAX_PENDING_EVALS) {
        val dropped = pendingEvals.removeFirst()
        emitEvalResult(dropped.first, null)
      }
      pendingEvals.addLast(Pair(evalId, script))
      return
    }
    evaluateJavascript(script) { res -> emitEvalResult(evalId, res) }
  }

  fun applyHtmlPayload(payload: ReadableMap?) {
    if (payload == null || destroyed) return
    val generation = if (payload.hasKey("generation") && !payload.isNull("generation")) payload.getInt("generation") else 0
    val html = if (payload.hasKey("html") && !payload.isNull("html")) payload.getString("html") ?: "" else ""
    val key = "$generation:${html.length}:${html.hashCode()}"
    if (key == lastAppliedHtmlKey) return
    lastAppliedHtmlKey = key
    currentGeneration = generation
    pageLoadedGeneration = -1
    // Cancel stale queued evals from previous document generation
    while (pendingEvals.isNotEmpty()) {
      val dropped = pendingEvals.removeFirst()
      emitEvalResult(dropped.first, null)
    }

    val injectedHtml = injectWebkitShimIntoHtml(html)
    loadDataWithBaseURL(PIX_WEBVIEW_BASE_URL, injectedHtml, "text/html", "UTF-8", null)
  }

  fun applyEvalQueue(queue: ReadableArray?) {
    if (queue == null || destroyed) return
    for (i in 0 until queue.size()) {
      val item = queue.getMap(i) ?: continue
      val evalId = if (item.hasKey("id") && !item.isNull("id")) item.getInt("id") else 0
      if (evalId <= lastPropEvalId) continue
      lastPropEvalId = evalId
      val script = item.getString("script") ?: continue
      enqueueOrEvalJs(evalId, script)
    }
  }

  fun markDestroyed() {
    destroyed = true
    pendingEvals.clear()
  }

  companion object {
    @SuppressLint("SetJavaScriptEnabled")
    fun configureWebView(wv: WebView) {
      wv.setBackgroundColor(Color.TRANSPARENT)
      wv.isVerticalScrollBarEnabled = true
      wv.isHorizontalScrollBarEnabled = true
      wv.overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
      wv.settings.apply {
        javaScriptEnabled = true
        domStorageEnabled = true
        databaseEnabled = true
        allowFileAccess = true
        allowContentAccess = true
        mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        useWideViewPort = false
        loadWithOverviewMode = false
        textZoom = 100
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          isAlgorithmicDarkeningAllowed = false
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          @Suppress("DEPRECATION")
          forceDark = WebSettings.FORCE_DARK_OFF
        }
      }
    }

    fun injectWebkitShimIntoHtml(html: String): String {
      val shimTag = "<script>$WEBKIT_SHIM_JS</script>"
      val headIdx = html.indexOf("<head>", ignoreCase = true)
      if (headIdx >= 0) {
        val insertAt = headIdx + "<head>".length
        return html.substring(0, insertAt) + shimTag + html.substring(insertAt)
      }
      val headOpenIdx = html.indexOf("<head ", ignoreCase = true)
      if (headOpenIdx >= 0) {
        val closeAngle = html.indexOf('>', headOpenIdx)
        if (closeAngle >= 0) {
          return html.substring(0, closeAngle + 1) + shimTag + html.substring(closeAngle + 1)
        }
      }
      val htmlIdx = html.indexOf("<html", ignoreCase = true)
      if (htmlIdx >= 0) {
        val closeAngle = html.indexOf('>', htmlIdx)
        if (closeAngle >= 0) {
          return html.substring(0, closeAngle + 1) + shimTag + html.substring(closeAngle + 1)
        }
      }
      return shimTag + html
    }
  }
}

class PixWebViewManager : SimpleViewManager<PixManagedWebView>() {
  override fun getName(): String = "PixWebView"

  override fun createViewInstance(reactContext: ThemedReactContext): PixManagedWebView =
    PixManagedWebView(reactContext)

  @ReactProp(name = "htmlPayload")
  fun setHtmlPayload(view: PixManagedWebView, payload: ReadableMap?) {
    view.applyHtmlPayload(payload)
  }

  @ReactProp(name = "evalQueue")
  fun setEvalQueue(view: PixManagedWebView, queue: ReadableArray?) {
    view.applyEvalQueue(queue)
  }

  override fun getCommandsMap(): MutableMap<String, Int> =
    MapBuilder.of("evaluateJS", COMMAND_EVALUATE_JS)

  @Deprecated("Deprecated in Java")
  override fun receiveCommand(root: PixManagedWebView, commandId: Int, args: ReadableArray?) {
    if (commandId == COMMAND_EVALUATE_JS) {
      handleEvalCommand(root, args)
    }
  }

  override fun receiveCommand(root: PixManagedWebView, commandId: String, args: ReadableArray?) {
    if (commandId == "evaluateJS" || commandId == COMMAND_EVALUATE_JS.toString()) {
      handleEvalCommand(root, args)
    }
  }

  private fun handleEvalCommand(root: PixManagedWebView, args: ReadableArray?) {
    if (args == null || args.size() < 2) return
    val evalId = args.getInt(0)
    val script = args.getString(1) ?: return
    root.enqueueOrEvalJs(evalId, script)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    MapBuilder.of(
      "topScriptMessage",
      MapBuilder.of("registrationName", "onScriptMessage"),
      "topLoadComplete",
      MapBuilder.of("registrationName", "onLoadComplete"),
      "topEvalResult",
      MapBuilder.of("registrationName", "onEvalResult"),
    )

  override fun onDropViewInstance(view: PixManagedWebView) {
    super.onDropViewInstance(view)
    view.markDestroyed()
    runCatching {
      view.stopLoading()
      view.destroy()
    }
  }
}
