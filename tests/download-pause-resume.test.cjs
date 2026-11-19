const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const ts = require("typescript")

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, label) {
  const started = Date.now()
  while (Date.now() - started < 3000) {
    if (predicate()) return
    await sleep(15)
  }
  throw new Error(`timeout: ${label}`)
}

function loadDownloadTaskManager() {
  const sourcePath = path.join(__dirname, "../Pix-Scripting/src/downloader/downloadTaskManager.ts")
  const source = fs.readFileSync(sourcePath, "utf8")
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const mod = { exports: {} }
  const customRequire = (id) => {
    if (id === "./directoryResolver") {
      return { getCategoryDirectory: () => "/mock-downloads" }
    }
    if (id === "./backgroundTaskManager") {
      return {
        beginBackgroundTask: async (options) => ({
          taskId: options.taskId || "default",
          updateProgress: () => {},
          stopProgressUpdates: () => {},
          finish: async () => {},
        }),
      }
    }
    if (id === "./downloadFileManager") {
      return { notifyDownloadFilesChanged: () => {} }
    }
    if (id === "./downloadHelper") {
      return { yieldToMainThread: () => Promise.resolve() }
    }
    if (id === "./TaskSignal") {
      return {
        consumeTaskSignal: () => null,
        clearTaskSignal: () => {},
        clearActiveTaskActivityMeta: () => {},
        peekTaskSignal: () => null,
      }
    }
    throw new Error(`Unexpected module request: ${id}`)
  }

  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: customRequire,
    console,
    AbortController,
    Date,
    Math,
    Map,
    Set,
    Array,
    Object,
    Promise,
    Error,
    JSON,
    Number,
    String,
    Boolean,
    setTimeout,
    clearTimeout,
    FileManager: {
      existsSync: () => false,
      isDirectorySync: () => false,
      readDirectorySync: () => [],
      readAsStringSync: () => "",
      writeAsStringSync: () => {},
      createDirectorySync: () => {},
      removeSync: () => {},
    },
  }

  vm.runInNewContext(js, sandbox, { filename: sourcePath })
  return mod.exports
}

function createControlledRunner() {
  let released = false
  let unblock = () => {}
  const releasedGate = new Promise((resolve) => {
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
        await Promise.race([releasedGate, sleep(25)])
      }
      await token.checkOrWait()
      return { summary: "done" }
    },
  }
}

test("下载队列隔离回归：排队任务暂停恢复、600ms 防抖及原 runner 续跑", async () => {
  const mod = loadDownloadTaskManager()
  const starts = []
  const progress = []
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

  const idA = `isoA_${Date.now()}`
  const idB = `isoB_${Date.now()}`
  const runningA = createControlledRunner()
  const queuedB = createControlledRunner()

  try {
    await mgr.submitTask({
      taskId: idA,
      type: "custom",
      title: "A-running",
      total: 2,
      runner: runningA.runner,
    })
    await waitFor(() => mgr.getTask(idA)?.status === "running", "A enters running")
    assert.equal(mgr.getActiveTask()?.id, idA, "active task should be A")
    assert.deepEqual(starts, [idA], "A should start once")

    await mgr.submitTask({
      taskId: idB,
      type: "custom",
      title: "B-queued",
      total: 2,
      runner: queuedB.runner,
    })
    await sleep(30)
    assert.equal(mgr.getTask(idB)?.status, "queued", "B should stay queued while A holds slot")
    assert.equal(starts.length, 1, "B must not start while A is running")

    assert.equal(await mgr.pauseTask(idB), true, "pause queued B")
    assert.equal(mgr.getTask(idB)?.status, "paused", "queued B becomes paused")
    assert.equal(await mgr.resumeTask(idB), false, "600ms debounce rejects immediate resume of queued B")
    assert.equal(mgr.getTask(idB)?.status, "paused", "debounced queued B stays paused")

    await sleep(650)
    assert.equal(await mgr.resumeTask(idB), true, "resume queued B after 600ms")
    assert.equal(mgr.getTask(idB)?.status, "queued", "paused queued task returns to queued")
    assert.equal(mgr.getTask(idB)?.statusText, "排队中…", "queued status text restored")
    assert.equal(mgr.getTask(idA)?.status, "running", "A stays running")
    assert.equal(mgr.getActiveTask()?.id, idA, "active slot stays on A")
    assert.equal(starts.length, 1, "restoring queued B must not start a runner")
    assert.equal(
      progress.every((item) => item.taskId !== idB),
      true,
      "queued B has no background handle to update"
    )

    runningA.release()
    await waitFor(
      () => mgr.getActiveTask()?.id === idB && mgr.getTask(idB)?.status === "running",
      "scheduler starts B after A finishes"
    )
    await waitFor(() => queuedB.loops() > 0, "B runner proceeds after token resume")
    assert.equal(mgr.getTask(idA)?.status, "completed", "A completes")
    assert.equal(starts.filter((id) => id === idB).length, 1, "B background starter called once")

    assert.equal(await mgr.pauseTask(idB), true, "pause running B")
    assert.equal(mgr.getTask(idB)?.status, "paused", "running B pauses")
    assert.equal(mgr.getActiveTask()?.id, idB, "paused running task keeps activeTaskId")
    assert.equal(await mgr.resumeTask(idB), false, "600ms debounce rejects immediate resume of running B")
    assert.equal(mgr.getTask(idB)?.status, "paused", "debounced running B stays paused")

    await sleep(650)
    const loopsWhilePaused = queuedB.loops()
    const startsBeforeResume = starts.length
    assert.equal(await mgr.resumeTask(idB), true, "resume running B after 600ms")
    assert.equal(mgr.getTask(idB)?.status, "running", "started task resumes to running")
    assert.equal(mgr.getTask(idB)?.statusText, "继续下载中…", "running resume status text updated")
    assert.equal(mgr.getActiveTask()?.id, idB, "running resume keeps active slot")
    assert.equal(starts.length, startsBeforeResume, "running resume must not start another runner")
    assert.equal(
      progress.some((item) => item.taskId === idB && item.statusText === "继续下载中…" && item.isPaused === false),
      true,
      "running resume updates existing background handle"
    )
    await waitFor(() => queuedB.loops() > loopsWhilePaused, "original runner continues after resume")

    queuedB.release()
    await waitFor(() => mgr.getTask(idB)?.status === "completed", "B completes")
    assert.equal(mgr.getActiveTask() ?? null, null, "slot released after B completes")
  } finally {
    runningA.release()
    queuedB.release()
    try {
      await mgr.cancelTask(idA)
      await mgr.cancelTask(idB)
    } catch {}
  }
})
