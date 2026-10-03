import { Button, HStack, Image, ProgressView, Spacer, Text, useState, VStack } from "scripting"
import { appGlass } from "./components/glass"
import type { NovelTranslationSession, NovelTranslationSnapshot } from "../store/novelTranslation"
import { NOVEL_TRANSLATION_TARGETS } from "../store/novelReaderSettings"

export function novelTranslationStatusText(snapshot: NovelTranslationSnapshot): string {
  if (snapshot.running && snapshot.phase === "summary") return "正在翻译标题、简介并生成摘要"
  if (snapshot.running && snapshot.phase === "glossary") return "正在整理术语表"
  if (snapshot.running) return "正在逐段翻译"
  if (snapshot.total > 0 && snapshot.done === snapshot.total) return "小说翻译完成"
  if (snapshot.failed > 0) return `已暂停，${snapshot.failed} 段待重试`
  if (snapshot.done > 0) return "已暂停，可继续翻译"
  return "小说尚未翻译"
}

function contextStatus(status: NovelTranslationSnapshot["summaryStatus"], kind: string): string {
  switch (status) {
    case "ready": return `${kind}已就绪`
    case "running": return `正在生成${kind}`
    case "error": return `${kind}生成失败，仍可翻译正文`
    case "skipped": return `${kind}无需生成`
    default: return `${kind}待生成`
  }
}

export function NovelTranslationStatus(props: {
  session: NovelTranslationSession
  snapshot: NovelTranslationSnapshot
  compact?: boolean
}) {
  const { session, snapshot, compact = false } = props
  const [detailsOpen, setDetailsOpen] = useState(false)
  const failures = Object.values(snapshot.blocks).filter((block) => block.status === "error")
  const contextNeedsRetry = snapshot.summaryStatus === "error" || snapshot.glossaryStatus === "error"
  const targetLabel = NOVEL_TRANSLATION_TARGETS.find((target) => target.id === snapshot.targetLanguage)?.label
    ?? snapshot.targetLanguage

  return (
    <VStack
      alignment="leading"
      spacing={compact ? 6 : 9}
      padding={{ horizontal: compact ? 12 : 14, vertical: compact ? 9 : 12 }}
      glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}
      frame={{ maxWidth: "infinity" }}
    >
      <HStack spacing={7} alignment="center" frame={{ maxWidth: "infinity" }}>
        <Image systemName="character.book.closed" font="subheadline" foregroundStyle="tintColor" />
        <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{novelTranslationStatusText(snapshot)}</Text>
        <Spacer />
        <Text font="caption" foregroundStyle="secondaryLabel">
          {`${snapshot.done}/${snapshot.total}${snapshot.failed ? ` · 失败 ${snapshot.failed}` : ""}`}
        </Text>
      </HStack>
      <ProgressView value={snapshot.done} total={Math.max(snapshot.total, 1)} progressViewStyle="linear" />
      <Text font="caption" foregroundStyle="secondaryLabel">
        {`目标：${targetLabel} · 标题、简介与摘要：${snapshot.summaryStatus === "ready" ? "已就绪" : snapshot.summaryStatus === "running" ? "生成中" : snapshot.summaryStatus === "error" ? "失败" : "待生成"} · 术语 ${snapshot.glossaryCount} 项${snapshot.seriesGlossaryCount ? `（系列继承 ${snapshot.seriesGlossaryCount}）` : ""}`}
      </Text>
      <HStack spacing={8} frame={{ maxWidth: "infinity" }}>
        <Button
          title={snapshot.mode === "translated" ? "看原文" : "看译文"}
          action={() => session.setMode(snapshot.mode === "translated" ? "original" : "translated")}
        />
        {snapshot.running ? (
          <Button title="暂停" action={() => session.pause()} />
        ) : snapshot.done < snapshot.total ? (
          <Button title={snapshot.done ? "继续" : "开始翻译"} action={() => {
            session.setMode("translated")
            void session.start()
          }} />
        ) : contextNeedsRetry ? (
          <Button title="重试译名、摘要与术语" action={() => void session.start([])} />
        ) : null}
        <Spacer />
        <Button title={detailsOpen ? "收起详情" : "译名、摘要与术语"} action={() => setDetailsOpen(!detailsOpen)} />
      </HStack>
      {snapshot.message ? <Text font="caption" foregroundStyle="systemRed">{snapshot.message}</Text> : null}
      {detailsOpen ? (
        <VStack alignment="leading" spacing={6} frame={{ maxWidth: "infinity" }}>
          <Text font="caption" foregroundStyle="secondaryLabel">{contextStatus(snapshot.summaryStatus, "标题、简介与摘要")}</Text>
          {snapshot.translatedTitle ? (
            <Text font="footnote">{`标题：${snapshot.translatedTitle}`}</Text>
          ) : null}
          {snapshot.translatedCaption ? (
            <Text font="footnote" lineLimit={compact ? 5 : undefined}>{`简介：${snapshot.translatedCaption}`}</Text>
          ) : null}
          {snapshot.summary ? <Text font="footnote" lineLimit={compact ? 5 : undefined}>{`故事摘要：${snapshot.summary}`}</Text> : null}
          <Text font="caption" foregroundStyle="secondaryLabel">
            {`${contextStatus(snapshot.glossaryStatus, "术语表")} · ${snapshot.glossaryCount} 项${snapshot.seriesGlossaryCount ? `（系列继承 ${snapshot.seriesGlossaryCount}）` : ""}`}
          </Text>
          {snapshot.glossary ? <Text font="footnote" lineLimit={compact ? 8 : undefined}>{snapshot.glossary}</Text> : null}
          <Text font="caption" foregroundStyle="secondaryLabel">{snapshot.thinkingNotice}</Text>
          {failures.length && !snapshot.running ? (
            <Button title={`重试全部失败段落（${failures.length}）`}
              action={() => void session.start(failures.map((block) => block.id))} />
          ) : null}
          {!snapshot.running ? failures.slice(0, 10).map((block) => (
            <Button key={block.id} title={`重试 ${block.id}：${block.error ?? "翻译失败"}`}
              action={() => void session.retry(block.id)} />
          )) : null}
        </VStack>
      ) : null}
    </VStack>
  )
}
