import { downloadEntireNovelSeries } from "../downloader/seriesDownloader"
import { loadNovelReaderSettings } from "../store/novelReaderSettings"
import { triggerHaptic } from "../platform/haptics"

/** 系列页、底部操作栏和追更菜单共用同一套原文／译文选择与错误反馈。 */
export async function downloadAndShareNovelSeries(
  seriesID: number,
  title: string,
  onDownloadingChanged?: (downloading: boolean) => void
): Promise<void> {
  const targetLanguage = loadNovelReaderSettings().translationTargetLanguage
  const choice = await Dialog.actionSheet({
    title: `下载整本小说《${title}》`,
    message: "译文 EPUB 需要全系列各话翻译完成；缺少译文时会提示对应章节。",
    actions: [
      { label: "原文 EPUB" },
      { label: `译文 EPUB（${targetLanguage}）` },
    ],
  })
  if (choice !== 0 && choice !== 1) return

  onDownloadingChanged?.(true)
  try {
    const filePath = await downloadEntireNovelSeries(seriesID, title, undefined, {
      mode: choice === 1 ? "translated" : "original", targetLanguage,
    })
    if (filePath) {
      triggerHaptic("success")
      await ShareSheet.present([filePath])
    } else {
      triggerHaptic("error")
      await Dialog.alert({ title: "导出失败", message: "无法生成 EPUB，请检查下载任务详情后重试" })
    }
  } catch (err: any) {
    triggerHaptic("error")
    await Dialog.alert({ title: "无法导出", message: String(err?.message ?? err) })
  } finally {
    onDownloadingChanged?.(false)
  }
}
