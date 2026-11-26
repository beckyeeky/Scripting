package com.pixscripting

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.view.View
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class PixGradientView(context: Context) : View(context) {
  private var colors: IntArray = intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT)
  private var startX = 0.5f
  private var startY = 0f
  private var endX = 0.5f
  private var endY = 1f
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private var shader: LinearGradient? = null

  fun setGradientColors(arr: ReadableArray?) {
    if (arr == null || arr.size() == 0) {
      colors = intArrayOf(Color.TRANSPARENT, Color.TRANSPARENT)
    } else if (arr.size() == 1) {
      val c = arr.getInt(0)
      colors = intArrayOf(c, c)
    } else {
      colors = IntArray(arr.size()) { idx -> arr.getInt(idx) }
    }
    shader = null
    invalidate()
  }

  fun updateStartX(v: Float) {
    startX = v
    shader = null
    invalidate()
  }

  fun updateStartY(v: Float) {
    startY = v
    shader = null
    invalidate()
  }

  fun updateEndX(v: Float) {
    endX = v
    shader = null
    invalidate()
  }

  fun updateEndY(v: Float) {
    endY = v
    shader = null
    invalidate()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    shader = null
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    if (width <= 0 || height <= 0) return
    if (shader == null) {
      shader = LinearGradient(
        startX * width,
        startY * height,
        endX * width,
        endY * height,
        colors,
        null,
        Shader.TileMode.CLAMP,
      )
      paint.shader = shader
    }
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
  }
}

class PixGradientViewManager : SimpleViewManager<PixGradientView>() {
  override fun getName(): String = "PixGradientView"

  override fun createViewInstance(reactContext: ThemedReactContext): PixGradientView =
    PixGradientView(reactContext)

  @ReactProp(name = "colors", customType = "ColorArray")
  fun setColors(view: PixGradientView, colors: ReadableArray?) {
    view.setGradientColors(colors)
  }

  @ReactProp(name = "startX", defaultFloat = 0.5f)
  fun setStartX(view: PixGradientView, v: Float) {
    view.updateStartX(v)
  }

  @ReactProp(name = "startY", defaultFloat = 0f)
  fun setStartY(view: PixGradientView, v: Float) {
    view.updateStartY(v)
  }

  @ReactProp(name = "endX", defaultFloat = 0.5f)
  fun setEndX(view: PixGradientView, v: Float) {
    view.updateEndX(v)
  }

  @ReactProp(name = "endY", defaultFloat = 1f)
  fun setEndY(view: PixGradientView, v: Float) {
    view.updateEndY(v)
  }
}
