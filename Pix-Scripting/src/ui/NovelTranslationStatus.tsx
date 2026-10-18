import {
  Button,
  HStack,
  Image,
  NavigationStack,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  TextField,
  Toggle,
  useState,
  VStack,
} from "scripting"
import { appGlass } from "./components/glass"
import { sheetDetents, sheetTopBar } from "./components/pageChrome"
import type { NovelTranslationSession, NovelTranslationSnapshot } from "../store/novelTranslation"
import { NOVEL_TRANSLATION_TARGETS } from "../store/novelReaderSettings"

export function novelTranslationStatusText(snapshot: NovelTranslationSnapshot): string {
  if (snapshot.running && snapshot.phase === "summary") return "正在翻译标题、简介并生成摘要"
  if (snapshot.running && snapshot.phase === "glossary") return "正在整理术语表"
  if (snapshot.running) return "正在逐段翻译"
  if (snapshot.total > 0 && snapshot.done === snapshot.total) return "小说翻译完成"
  if (snapshot.stale > 0) return `原文有改动，${snapshot.stale} 段需重新翻译`
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
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const failures = Object.values(snapshot.blocks).filter((block) => block.status === "error")
  const contextNeedsRetry = snapshot.summaryStatus === "error" || snapshot.glossaryStatus === "error"
  const targetLabel = NOVEL_TRANSLATION_TARGETS.find((target) => target.id === snapshot.targetLanguage)?.label
    ?? snapshot.targetLanguage
  // 发送范围与供应商：明确告知用户会发送什么（只含类别，不含端点与密钥）
  const sendScope = (() => {
    try {
      return session.sendScopeNotice(session.currentProviderKind())
    } catch {
      return ""
    }
  })()
  const warnings = (() => {
    try {
      return session.alignmentWarnings()
    } catch {
      return []
    }
  })()

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
      {Object.values(snapshot.blocks).filter((block) => block.status === "running" &&
        block.attempt && block.attempt.stage !== "original").map((block) => (
        <Text key={`split-${block.id}`} font="caption" foregroundStyle="secondaryLabel">
          {block.attempt!.stage === "merge"
            ? `${block.id}：三段已完成，正在合并校验`
            : `${block.id}：拆分重试第 ${block.attempt!.splitPart}/3 段，已完成 ${block.attempt!.splitCompleted}/3`}
        </Text>
      ))}
      <Text font="caption" foregroundStyle="secondaryLabel">
        {`分段状态：完成 ${snapshot.done} · 未完成 ${Math.max(0, snapshot.total - snapshot.done - snapshot.failed)}${snapshot.failed ? ` · 失败 ${snapshot.failed}` : ""}${snapshot.stale ? ` · 失效 ${snapshot.stale}` : ""}${snapshot.stale ? "（旧译文不会静默复用）" : ""}`}
      </Text>
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
        <Button title="术语表" action={() => setGlossaryOpen(true)} />
        <Button title={detailsOpen ? "收起详情" : "译名、摘要与术语"} action={() => setDetailsOpen(!detailsOpen)} />
      </HStack>
      <VStack
        frame={{ width: 0, height: 0 }}
        sheet={{
          isPresented: glossaryOpen,
          onChanged: setGlossaryOpen,
          content: (
            <NovelGlossarySheet
              session={session}
              snapshot={snapshot}
              onClose={() => setGlossaryOpen(false)}
            />
          ),
        }}
      />
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
          {sendScope ? (
            <Text font="caption2" foregroundStyle="secondaryLabel">{`发送范围：${sendScope}`}</Text>
          ) : null}
          {warnings.map((warning) => (
            <Text key={warning} font="caption2" foregroundStyle="secondaryLabel">{warning}</Text>
          ))}
          <Text font="caption" foregroundStyle="secondaryLabel">{snapshot.thinkingNotice}</Text>
          {failures.length && !snapshot.running ? (
            <Button title={`重试全部失败段落（${failures.length}）`}
              action={() => void session.start(failures.map((block) => block.id), true)} />
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

/**
 * 术语表编辑与锁定。
 *
 * 格式：每行「类别｜原文｜译文[｜备注]」，与既有解析格式一致；
 * 锁定后不再自动重新生成，且该术语表始终进入翻译 prompt（系列术语只补缺）。
 */
export function NovelGlossarySheet(props: {
  session: NovelTranslationSession
  snapshot: NovelTranslationSnapshot
  onClose?: () => void
}) {
  const { session, snapshot, onClose } = props
  const [draft, setDraft] = useState(snapshot.glossary ?? "")
  const [locked, setLocked] = useState(Boolean(snapshot.glossaryLocked))
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    session.setGlossary(draft, locked)
    setSaved(true)
  }

  return (
    <NavigationStack presentationDetents={sheetDetents([0.7, "large"])} presentationDragIndicator="visible">
      <ScrollView
        {...sheetTopBar()}
        navigationTitle="术语表"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: onClose ? [<Button key="close" title="关闭" systemImage="xmark" action={onClose} />] : undefined,
          topBarTrailing: [
            <Button key="save" title="保存" fontWeight="bold" action={handleSave} />,
          ],
        }}
      >
        <VStack alignment="leading" spacing={10} padding={{ horizontal: 8, bottom: 28 }} frame={{ maxWidth: "infinity" }}>
          <Text font="caption" foregroundStyle="secondaryLabel">
            {`每行一条：类别｜原文｜译文｜备注（备注可省略）。当前共 ${snapshot.glossaryCount} 条${snapshot.seriesGlossaryCount ? `，系列继承 ${snapshot.seriesGlossaryCount} 条` : ""}。`}
          </Text>
          <TextField
            title="术语表"
            prompt="人物｜琳｜琳（Rin）"
            value={draft}
            onChanged={(value: string) => {
              setDraft(value)
              setSaved(false)
            }}
          />
          <Toggle
            title="锁定术语表"
            value={locked}
            onChanged={(value: boolean) => {
              setLocked(value)
              setSaved(false)
            }}
          />
          <Text font="caption" foregroundStyle="secondaryLabel">
            锁定后不会自动重新生成术语；系列术语只会补充缺失条目，不会覆盖你编辑或锁定的内容。
          </Text>
          {snapshot.message ? <Text font="caption" foregroundStyle="systemRed">{snapshot.message}</Text> : null}
          {saved ? (
            <HStack spacing={6} alignment="center">
              <Image systemName="checkmark.circle" font="footnote" foregroundStyle="systemGreen" />
              <Text font="footnote" foregroundStyle="secondaryLabel">
                {locked ? "已保存并锁定，后续翻译将沿用该术语表" : "已保存，未锁定，仍会自动补全缺失术语"}
              </Text>
            </HStack>
          ) : null}
          {snapshot.stale > 0 ? (
            <Text font="caption" foregroundStyle="systemOrange">
              {`有 ${snapshot.stale} 段原文已改动，旧译文已失效；保存术语后重新翻译这些段落即可。`}
            </Text>
          ) : null}
        </VStack>
      </ScrollView>
    </NavigationStack>
  )
}
