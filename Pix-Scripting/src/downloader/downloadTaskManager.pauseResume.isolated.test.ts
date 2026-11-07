import { Script } from "scripting"

/**
 * 对 downloadTaskManager 的真实 pause/resume/scheduleNext 做隔离运行。
 * 使用 createIsolatedDownloadTaskManager，不写任务目录、不读信号文件、不启动灵动岛。
 * 覆盖：A 运行时 B 排队暂停再恢复、已运行任务恢复、600ms 防抖。
 *
 * 运行：scripting-ts run src/downloader/downloadTaskManager.pauseResume.isolated.test.ts
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 3000) {
    if (predicate()) return
    await sleep(20)
  }
  throw new Error(`timeout: ${label}`)
}

type ControlledRunner = {
  runner: (
    token: {
      checkOrWait: () => Promise<void>
    }
  ) => Promise<{ summary?: string }>
  release: () => void
  loops: () => number
}

function createRunner(): ControlledRunner {
  let released = false
  let unblock = () => {}
  const releasedGate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  let loopCount = 0
  return {
    loops: () => loopCount,
    release: () => {
      released = true
      unblock()
    },
    runner: async (token) => {
      while (!released) {
        await token.checkOrWait()
        loopCount += 1
        if (released) break
        await Promise.race([releasedGate, sleep(30)])
      }
      await token.checkOrWait()
      return { summary: "done" }
    },
  }
}

async function main(): Promise<void> {
  const mod = await import("./downloadTaskManager")
  const starts: string[] = []
  const progress: Array<{ taskId: string; statusText: string; isPaused?: boolean }> = []
  const mgr = mod.createIsolatedDownloadTaskManager({
    backgroundStarter: async (options) => {
      const taskId = options.taskId || "unknown"
      starts.push(taskId)
      return {
        taskId,
        updateProgress: (update) => {
          progress.push({
            taskId,
            statusText: update.statusText,
            isPaused: update.isPaused,
          })
        },
        stopProgressUpdates: () => {},
        finish: async () => {},
      }
    },
  })

  const stamp = Date.now()
  const idA = `isoA_${stamp}`
  const idB = `isoB_${stamp}`
  const runningA = createRunner()
  const queuedB = createRunner()
  const results: string[] = []

  try {
    await mgr.submitTask({
      taskId: idA,
      type: "custom",
      title: "A-running",
      total: 2,
      runner: runningA.runner,
    })
    await waitFor(() => mgr.getTask(idA)?.status === "running", "A enters running")
    assert(mgr.getActiveTask()?.id === idA, "active task should be A")
    assert(starts.length === 1 && starts[0] === idA, `A should start once, starts=${starts.join(",")}`)

    await mgr.submitTask({
      taskId: idB,
      type: "custom",
      title: "B-queued",
      total: 2,
      runner: queuedB.runner,
    })
    await sleep(40)
    assert(mgr.getTask(idB)?.status === "queued", `B should stay queued, got ${mgr.getTask(idB)?.status}`)
    assert(starts.length === 1, "B must not start while A holds the slot")

    assert(await mgr.pauseTask(idB) === true, "pause queued B")
    assert(mgr.getTask(idB)?.status === "paused", "queued B becomes paused")
    // 排队任务 token 初始未暂停，pauseTask 走 !token.isPaused 分支并写下 600ms 时间戳。
    assert(await mgr.resumeTask(idB) === false, "debounce should reject immediate resume of queued B")
    assert(mgr.getTask(idB)?.status === "paused", "debounced queued B stays paused")
    results.push("debounce-queued")

    await sleep(700)
    assert(await mgr.resumeTask(idB) === true, "resume queued B after 600ms")
    assert(
      mgr.getTask(idB)?.status === "queued",
      `paused queued task must return to queued, got ${mgr.getTask(idB)?.status}`
    )
    assert(mgr.getTask(idB)?.statusText === "排队中…", `queued status text, got ${mgr.getTask(idB)?.statusText}`)
    assert(mgr.getTask(idA)?.status === "running", "A stays running")
    assert(mgr.getActiveTask()?.id === idA, "active slot stays on A")
    assert(starts.length === 1, "restoring queued B must not start a runner")
    assert(
      progress.every((item) => item.taskId !== idB),
      "queued B has no background handle to update"
    )
    results.push("queued-pause-resume")

    runningA.release()
    await waitFor(
      () => mgr.getActiveTask()?.id === idB && mgr.getTask(idB)?.status === "running",
      "scheduler starts B after A finishes"
    )
    await waitFor(() => queuedB.loops() > 0, "B runner actually proceeds (token was resumed)")
    assert(mgr.getTask(idA)?.status === "completed", `A should complete, got ${mgr.getTask(idA)?.status}`)
    assert(starts.filter((id) => id === idB).length === 1, "B background starter called once")
    results.push("queued-resumed-schedulable")

    assert(await mgr.pauseTask(idB) === true, "pause the running task")
    assert(mgr.getTask(idB)?.status === "paused", "running task pauses")
    assert(mgr.getActiveTask()?.id === idB, "paused running task keeps activeTaskId")
    assert(await mgr.resumeTask(idB) === false, "debounce should reject immediate resume of running B")
    assert(mgr.getTask(idB)?.status === "paused", "debounced running task stays paused")
    results.push("debounce-running")

    await sleep(700)
    const loopsWhilePaused = queuedB.loops()
    const startsBeforeResume = starts.length
    assert(await mgr.resumeTask(idB) === true, "resume running task after 600ms")
    assert(mgr.getTask(idB)?.status === "running", "started task resumes to running")
    assert(
      mgr.getTask(idB)?.statusText === "继续下载中…",
      `running resume text, got ${mgr.getTask(idB)?.statusText}`
    )
    assert(mgr.getActiveTask()?.id === idB, "running resume keeps the same active slot")
    assert(starts.length === startsBeforeResume, "running resume must not start another runner")
    assert(
      progress.some(
        (item) => item.taskId === idB && item.statusText === "继续下载中…" && item.isPaused === false
      ),
      "running resume still updates the existing background handle"
    )
    await waitFor(() => queuedB.loops() > loopsWhilePaused, "original runner continues after resume")
    results.push("running-resume")

    queuedB.release()
    await waitFor(() => mgr.getTask(idB)?.status === "completed", "B completes")
    assert(mgr.getActiveTask() == null, "slot released after B completes")
    results.push("done")

    Script.exit(JSON.stringify({ ok: true, results, starts }))
  } catch (error) {
    runningA.release()
    queuedB.release()
    try {
      await mgr.cancelTask(idA)
      await mgr.cancelTask(idB)
    } catch {}
    Script.exit(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.stack || error.message : String(error),
        results,
        starts,
        tasks: mgr.getAllTasks().map((task) => ({
          id: task.id,
          status: task.status,
          statusText: task.statusText,
        })),
      })
    )
  }
}

void main()
