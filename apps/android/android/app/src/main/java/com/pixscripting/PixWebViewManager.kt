package com.pixscripting

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Build
import android.webkit.JavascriptInterface
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
  private var lastAppliedHtmlKey: String = ""
  private var lastEvalId: Int = 0

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
          themedContext
            .getJSModule(RCTEventEmitter::class.java)
            .receiveEvent(id, "topScriptMessage", event)
        }
      }
    }, "__PixAndroidWebBridge")

    webViewClient = object : WebViewClient() {
      override fun onPageFinished(view: WebView?, url: String?) {
        super.onPageFinished(view, url)
        view?.evaluateJavascript(WEBKIT_SHIM_JS, null)
        val event = Arguments.createMap().apply {
          putInt("generation", currentGeneration)
          putBoolean("success", true)
        }
        themedContext
          .getJSModule(RCTEventEmitter::class.java)
          .receiveEvent(id, "topLoadComplete", event)
      }

      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
        val targetUrl = request?.url?.toString() ?: return false
        if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://") || targetUrl.startsWith("pixiv://")) {
          val payloadJson = org.json.JSONObject().put("url", targetUrl).toString()
          val event = Arguments.createMap().apply {
            putString("name", "openLink")
            putString("payload", payloadJson)
            putInt("generation", currentGeneration)
          }
          themedContext
            .getJSModule(RCTEventEmitter::class.java)
            .receiveEvent(id, "topScriptMessage", event)
          return true
        }
        return false
      }
    }
  }

  fun applyHtmlPayload(payload: ReadableMap?) {
    if (payload == null) return
    val generation = if (payload.hasKey("generation")) payload.getInt("generation") else 0
    val html = if (payload.hasKey("html")) payload.getString("html") ?: "" else ""
    val key = "$generation:${html.length}:${html.hashCode()}"
    if (key == lastAppliedHtmlKey) return
    lastAppliedHtmlKey = key
    currentGeneration = generation

    // Prepend webkit shim right inside <head> or start of HTML so inline scripts see window.webkit immediately
    val injectedHtml = injectWebkitShimIntoHtml(html)
    loadDataWithBaseURL("https://appassets.pixscripting.local/", injectedHtml, "text/html", "UTF-8", null)
  }

  fun applyEvalQueue(queue: ReadableArray?) {
    if (queue == null) return
    for (i in 0 until queue.size()) {
      val item = queue.getMap(i) ?: continue
      val evalId = if (item.hasKey("id")) item.getInt("id") else 0
      if (evalId <= lastEvalId) continue
      lastEvalId = evalId
      val script = item.getString("script") ?: continue
      evaluateJavascript(script, null)
    }
  }

  companion object {
    @SuppressLint("SetJavaScriptEnabled")
    fun configureWebView(wv: WebView) {
      wv.setBackgroundColor(Color.TRANSPARENT)
      wv.isVerticalScrollBarEnabled = true
      wv.isHorizontalScrollBarEnabled = true
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          @Suppress("DEPRECATION")
          forceDark = WebSettings.FORCE_DARK_AUTO
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

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    MapBuilder.of(
      "topScriptMessage",
      MapBuilder.of("registrationName", "onScriptMessage"),
      "topLoadComplete",
      MapBuilder.of("registrationName", "onLoadComplete"),
    )

  override fun onDropViewInstance(view: PixManagedWebView) {
    super.onDropViewInstance(view)
    runCatching {
      view.stopLoading()
      view.destroy()
    }
  }
}
