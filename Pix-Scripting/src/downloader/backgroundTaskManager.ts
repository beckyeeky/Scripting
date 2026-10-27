import {
  Notification,
  Script,
} from "scripting"
import { PixivTaskLiveActivity, type TaskLiveActivityState } from "../../live_activity"
import { loadSettings } from "../store/settings"
import { triggerHaptic } from "../platform/haptics"
import { isScriptingProUser } from "../platform/pro"
import {
  saveActiveTaskActivityMeta,
  clearActiveTaskActivityMeta,
  clearTaskSignal,
  peekTaskSignal,
} from "./TaskSignal"

export interface BackgroundTaskOptions {
  taskId?: string
  title: string
  subtitle?: string
  total?: number
  categoryIcon?: string
  initialStatus?: string
}

export interface BackgroundTaskHandle {
  taskId: string
  updateProgress: (options: {
    current: number
    total?: number
    statusText: string
    isPaused?: boolean
  }) => void
  // 仅撤销进度发布；取消入口使用，实际收尾及保活释放仍由 finish 负责。
  stopProgressUpdates?: () => void
  finish: (options: {
    success: boolean
    summary: string
    errorMessage?: string
    detailTitle?: string
    isCanceled?: boolean
  }) => Promise<void>
}

/**
 * 全局后台保活引用计数中枢（严格保证多任务、相册批量写入与子流程并发时保活不被意外中断）
 */
let globalKeepAliveRefCount = 0

/**
 * 申请全局系统后台保活令牌（Pro 权限门禁拦截）
 * 仅在首次申请（引用计数从 0 -> 1）时真正触发系统 BackgroundKeeper.keepAlive()
 */
export async function acquireGlobalKeepAlive(): Promise<boolean> {
  if (!isScriptingProUser()) return false
  globalKeepAliveRefCount++
  if (globalKeepAliveRefCount === 1) {
    try {
      if (typeof BackgroundKeeper !== "undefined" && typeof BackgroundKeeper.keepAlive === "function") {
        const started = await BackgroundKeeper.keepAlive()
        if (!started) {
          console.log("BackgroundKeeper.keepAlive: system refused")
          globalKeepAliveRefCount = 0
          return false
        }
        return true
      }
    } catch (e: any) {
      console.log("BackgroundKeeper.keepAlive error:", e?.message ?? e)
      globalKeepAliveRefCount = 0
      return false
    }
  }
  return true
}

/**
 * 释放全局系统后台保活令牌
 * 仅当全进程所有持有者全部释放（引用计数严格降至 0）时才真正触发 BackgroundKeeper.stopKeepAlive()
 */
export async function releaseGlobalKeepAlive(): Promise<void> {
  if (!isScriptingProUser()) return
  if (globalKeepAliveRefCount > 0) {
    globalKeepAliveRefCount--
  }
  if (globalKeepAliveRefCount === 0) {
    try {
      if (typeof BackgroundKeeper !== "undefined" && typeof BackgroundKeeper.stopKeepAlive === "function") {
        await BackgroundKeeper.stopKeepAlive()
      }
    } catch (e: any) {
      console.log("BackgroundKeeper.stopKeepAlive error:", e?.message ?? e)
    }
  }
}

/**
 * 启动后台任务管理：包含后台保活、灵动岛实时活动生命周期与任务完成通知
 */
export async function beginBackgroundTask(
  options: BackgroundTaskOptions
): Promise<BackgroundTaskHandle> {
  const taskId = options.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const settings = loadSettings()
  
  // 1. 开启系统后台保活（统一通过全局单例中枢申请，Pro 用户门禁）
  let isKeptAlive = false
  if (isScriptingProUser()) {
    isKeptAlive = await acquireGlobalKeepAlive()
  }

  // 2. 检查灵动岛能力与用户设置
  let liveActivityInstance: ReturnType<typeof PixivTaskLiveActivity> | null = null
  let currentTotal = options.total && options.total > 0 ? options.total : 1
  let currentCount = 0
  let isFinished = false
  let lastUpdateTime: number | null = null
  let isCurrentlyPaused = false
  let progressStopped = false
  let progressTimer: ReturnType<typeof setTimeout> | null = null
  let pendingStatusText: string | null = null
  let lastPublishedState: TaskLiveActivityState | null = null

  if (settings.enableLiveActivity) {
    try {
      liveActivityInstance = PixivTaskLiveActivity()
      const initialState: TaskLiveActivityState = {
        taskId,
        title: options.title,
        subtitle: options.subtitle,
        statusText: options.initialStatus || "正在准备任务…",
        progress: 0.0,
        current: 0,
        total: currentTotal,
        categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
        isDone: false,
        isError: false,
        isPaused: false,
      }
      await liveActivityInstance.start(initialState)
      saveActiveTaskActivityMeta({
        taskId,
        activityId: liveActivityInstance.activityId,
        title: options.title,
        subtitle: options.subtitle,
        statusText: options.initialStatus || "正在准备任务…",
        progress: 0.0,
        current: 0,
        total: currentTotal,
        categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
        isPaused: false,
        isDone: false,
        isError: false,
        updatedAt: Date.now(),
      })
    } catch (err: any) {
      console.log("LiveActivity start error:", err?.message ?? err)
      liveActivityInstance = null
    }
  }

  // 3. 普通进度首发 + 80ms 合并尾发；控制态按有效状态变化立即发布。
  const clearProgressTimer = () => {
    if (progressTimer !== null) {
      clearTimeout(progressTimer)
      progressTimer = null
    }
  }

  const stopProgressUpdates = () => {
    progressStopped = true
    clearProgressTimer()
    pendingStatusText = null
  }

  const flushProgress = () => {
    clearProgressTimer()
    if (isFinished || progressStopped || pendingStatusText === null || !liveActivityInstance) return

    // 尾发时重新检查，不能重放排队前的 false，也不能在取消后重建活动元数据。
    const pendingSignal = peekTaskSignal(taskId)
    if (pendingSignal === "cancel") {
      stopProgressUpdates()
      return
    }
    if (pendingSignal === "pause") isCurrentlyPaused = true

    const state: TaskLiveActivityState = {
      taskId,
      title: options.title,
      subtitle: options.subtitle,
      statusText: isCurrentlyPaused ? "任务已暂停" : pendingStatusText,
      progress: Math.max(0, Math.min(1, currentTotal > 0 ? currentCount / currentTotal : 0)),
      current: currentCount,
      total: currentTotal,
      categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
      isDone: false,
      isError: false,
      isPaused: isCurrentlyPaused,
    }
    pendingStatusText = null
    if (lastPublishedState &&
      lastPublishedState.current === state.current &&
      lastPublishedState.total === state.total &&
      lastPublishedState.statusText === state.statusText &&
      lastPublishedState.isPaused === state.isPaused) return

    lastUpdateTime = Date.now()
    lastPublishedState = state
    try {
      // update 返回 Promise；只记录失败，不排队重试，避免 finish 后再派发。
      void liveActivityInstance.update(state).catch((err: any) => {
        console.log("LiveActivity update error:", err?.message ?? err)
      })
      saveActiveTaskActivityMeta({
        ...state,
        taskId,
        activityId: liveActivityInstance.activityId,
        updatedAt: Date.now(),
      })
    } catch (err: any) {
      console.log("LiveActivity update error:", err?.message ?? err)
    }
  }

  const updateProgress = (progressOptions: {
    current: number
    total?: number
    statusText: string
    isPaused?: boolean
  }) => {
    if (isFinished || progressStopped) return
    const wasComplete = currentCount >= currentTotal
    if (progressOptions.total && progressOptions.total > 0) {
      currentTotal = progressOptions.total
    }
    currentCount = Math.max(0, progressOptions.current)

    // pending pause 优先于包装层的稳定布尔值；不消费或改写控制信号。
    const pendingSignal = peekTaskSignal(taskId)
    if (pendingSignal === "cancel") {
      stopProgressUpdates()
      return
    }
    if (pendingSignal === "pause") {
      isCurrentlyPaused = true
    } else if (progressOptions.isPaused !== undefined) {
      isCurrentlyPaused = Boolean(progressOptions.isPaused)
    }
    if (!liveActivityInstance) return
    pendingStatusText = progressOptions.statusText

    const now = Date.now()
    const elapsed = lastUpdateTime === null ? 80 : now - lastUpdateTime
    const pauseChanged = lastPublishedState !== null && lastPublishedState.isPaused !== isCurrentlyPaused
    // 100% 只是进度边沿，不是任务终态；重复满值不能持续绕过限频。
    const completionEdge = currentCount >= currentTotal && !wasComplete
    if (lastUpdateTime === null || pauseChanged || completionEdge || elapsed >= 80 || elapsed < 0) {
      flushProgress()
    } else if (progressTimer === null) {
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        if (progressTimer !== timer) return
        progressTimer = null
        flushProgress()
      }, 80 - elapsed)
      progressTimer = timer
    }
  }

  // 4. 完成任务函数
  const finish = async (finishOptions: {
    success: boolean
    summary: string
    errorMessage?: string
    detailTitle?: string
    isCanceled?: boolean
  }) => {
    if (isFinished) return
    isFinished = true
    stopProgressUpdates()

    clearActiveTaskActivityMeta()
    clearTaskSignal(taskId)

    const currentSettings = loadSettings()
    const isCanceled = Boolean(finishOptions.isCanceled)

    // 4.1 结束灵动岛实时活动：取消时立即销毁(0秒)；成功保留4秒；真错误保留6秒
    if (liveActivityInstance) {
      try {
        const finalState: TaskLiveActivityState = {
          taskId,
          title: finishOptions.detailTitle || options.title,
          subtitle: options.subtitle,
          statusText: finishOptions.summary,
          progress: finishOptions.success ? 1.0 : (currentTotal > 0 ? currentCount / currentTotal : 0),
          current: finishOptions.success ? currentTotal : currentCount,
          total: currentTotal,
          categoryIcon: options.categoryIcon || "square.and.arrow.down.fill",
          isDone: finishOptions.success,
          isError: !finishOptions.success && !isCanceled,
          isPaused: false,
        }
        await liveActivityInstance.end(finalState, {
          dismissTimeInterval: isCanceled ? 0 : finishOptions.success ? 4 : 6,
        })
      } catch (err: any) {
        console.log("LiveActivity end error:", err?.message ?? err)
      }
      liveActivityInstance = null
    }

    // 4.2 发送本地通知与震动反馈（主动取消不打扰、不误报失败）
    if (currentSettings.enableTaskNotification && !isCanceled) {
      try {
        const notifyTitle = finishOptions.success
          ? `✅ ${options.title}完成`
          : `❌ ${options.title}失败`

        await Notification.schedule({
          title: notifyTitle,
          subtitle: options.subtitle,
          body: finishOptions.summary,
          silent: false,
          tapAction: "none",
        })
      } catch (err: any) {
        console.log("Notification.schedule error:", err?.message ?? err)
      }
    }

    // 触感反馈（取消不触发错误触感）
    if (!isCanceled) {
      if (finishOptions.success) {
        triggerHaptic("success")
      } else {
        triggerHaptic("error")
      }
    }

    // 4.3 释放后台保活（通过全局单例中枢安全扣减，仅当全局引用归零时才真正注销系统保活）
    if (isKeptAlive) {
      isKeptAlive = false
      await releaseGlobalKeepAlive()
    }
  }

  return {
    taskId,
    updateProgress,
    stopProgressUpdates,
    finish,
  }
}

/**
 * 用后台任务与灵动岛托管执行异步任务（具备自动完结兜底保护）
 */
export async function runWithBackgroundTask<T>(
  options: BackgroundTaskOptions,
  runner: (task: BackgroundTaskHandle) => Promise<T>
): Promise<T> {
  const task = await beginBackgroundTask(options)
  let isFinished = false

  // 包装 handle，记录外部 runner 是否已主动 finish
  const wrappedTask: BackgroundTaskHandle = {
    ...task,
    finish: async (res) => {
      isFinished = true
      await task.finish(res)
    },
  }

  try {
    const result = await runner(wrappedTask)
    // 成功路径兜底：若 runner 执行完毕后未显式调用 finish，自动标记成功并释放保活
    if (!isFinished) {
      await task.finish({ success: true, summary: "任务已完成" })
    }
    return result
  } catch (error: any) {
    // 异常路径兜底：若 runner 抛出异常前未显式 finish，自动标记失败并上报错误
    if (!isFinished) {
      await task.finish({
        success: false,
        summary: error?.message ? `执行中断: ${error.message}` : "任务执行过程中发生异常",
        errorMessage: String(error),
      })
    }
    throw error
  }
}
