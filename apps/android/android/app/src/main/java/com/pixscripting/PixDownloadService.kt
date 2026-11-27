package com.pixscripting

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Minimal foreground service used while downloads/exports are running.
 *
 * The JS side only calls this through `BackgroundKeeper.keepAlive()` when the
 * background task manager takes its first reference and stops it when the last
 * reference is released, so the service is intentionally short lived: no
 * wake locks, no restart, no long-running work of its own.
 */
class PixDownloadService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    ensureChannel()
    val notification =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle("Pix-Scripting")
        .setContentText("正在后台下载/导出，请保持应用运行")
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setContentIntent(openAppIntent())
        .build()
    // Android 14 throws if the declared type is missing from the manifest or
    // the start is not allowed; the JS keeper treats a failure as "not kept
    // alive" instead of crashing the download flow.
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (_: Throwable) {
      stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    runCatching { stopForeground(STOP_FOREGROUND_REMOVE) }
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (nm.getNotificationChannel(CHANNEL_ID) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "下载与导出", NotificationManager.IMPORTANCE_LOW)
      )
    }
  }

  private fun openAppIntent(): PendingIntent {
    val intent =
      Intent(this, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      }
    val flags =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }
    return PendingIntent.getActivity(this, 0, intent, flags)
  }

  companion object {
    private const val CHANNEL_ID = "pix_scripting_downloads"
    private const val NOTIFICATION_ID = 9902
    private const val ACTION_STOP = "com.pixscripting.action.STOP_DOWNLOAD_SERVICE"

    /** Returns false when the platform refuses to start the service (e.g. background restrictions). */
    fun start(context: Context): Boolean =
      runCatching {
        val intent = Intent(context, PixDownloadService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      }.getOrDefault(false)

    fun stop(context: Context) {
      runCatching { context.stopService(Intent(context, PixDownloadService::class.java)) }
    }
  }
}
