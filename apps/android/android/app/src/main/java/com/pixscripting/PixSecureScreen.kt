package com.pixscripting

import android.app.Activity
import android.view.Window
import android.view.WindowManager

/**
 * FLAG_SECURE（禁止截屏 / 后台预览遮挡）的期望状态与落地。
 *
 * JS 侧 setSecureScreen() 可能在 Activity 尚未创建、已销毁或应用在后台时到达
 * （冷启动、React 实例复用、切换账号重建 Activity），因此这里只记住期望值并
 * 尽力应用；MainActivity 在 onCreate/onResume 调 applyPending() 补齐，保证
 * 重启后按已存设置恢复，也保证新 Activity 不会漏掉遮罩。
 *
 * FLAG_SECURE 只影响屏幕捕获（截图/录屏）与最近任务预览；写文件、相册保存与
 * FileProvider 分享不经过 Window 捕获，因此不受影响。
 */
object PixSecureScreen {
  private val lock = Any()

  @Volatile
  private var desiredEnabled: Boolean? = null

  fun setDesired(enabled: Boolean) {
    synchronized(lock) { desiredEnabled = enabled }
  }

  fun requested(): Boolean? = desiredEnabled

  fun applyToWindow(window: Window?, enabled: Boolean? = null): Boolean {
    val target = enabled ?: desiredEnabled ?: return false
    if (window == null) return false
    return runCatching {
      if (target) {
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } else {
        window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
      true
    }.getOrDefault(false)
  }

  fun applyTo(activity: Activity?, enabled: Boolean? = null): Boolean {
    val window = activity?.window ?: return false
    return applyToWindow(window, enabled)
  }

  fun applyPending(activity: Activity?): Boolean = applyTo(activity)
}
