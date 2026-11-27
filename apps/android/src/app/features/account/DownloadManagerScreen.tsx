import React, { useCallback, useEffect, useMemo, useState } from "react"
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import { getDownloadRootDirectory } from "../../../../../../Pix-Scripting/src/downloader/directoryResolver"
import {
  addDownloadFilesChangeListener,
  cleanTempCache,
  deleteCreatorDirectory,
  deleteManagedFile,
  formatBytes,
  getStorageOverview,
  renameManagedFile,
  scanCategoryFiles,
  scanCreatorDirectories,
  scanCreatorFiles,
  shareFilesSystem,
  type CreatorFolderItem,
  type DownloadFileCategory,
  type ManagedFileItem,
  type SortMode,
  type StorageOverview,
} from "../../../../../../Pix-Scripting/src/downloader/downloadFileManager"
import {
  DownloadTaskManager,
  type DownloadTaskItem,
} from "../../../../../../Pix-Scripting/src/downloader/downloadTaskManager"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  ActionButton,
  ChipBar,
  EmptyView,
  HeaderIconButton,
  ScreenHeader,
  SectionCard,
  SectionHeader,
  SegmentedControl,
  SettingRow,
  ThemedTextInput,
  type ChipItem,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

type SectionTab = "overview" | "tasks" | "category" | "creators"

const CATEGORY_CHIPS: ReadonlyArray<ChipItem<DownloadFileCategory>> = [
  { value: "all", label: "全部" },
  { value: "illustrations", label: "插画" },
  { value: "manga", label: "漫画" },
  { value: "novels", label: "小说" },
  { value: "ugoira", label: "动图" },
  { value: "pixivision", label: "特辑" },
]

const CREATOR_SUB_CHIPS: ReadonlyArray<
  ChipItem<"all" | "illustrations" | "ugoira" | "manga" | "novels">
> = [
  { value: "all", label: "全部" },
  { value: "illustrations", label: "插画" },
  { value: "manga", label: "漫画" },
  { value: "novels", label: "小说" },
  { value: "ugoira", label: "动图" },
]

const SORT_LABELS: Record<SortMode, string> = {
  date_desc: "最新优先",
  date_asc: "最早优先",
  size_desc: "从大到小",
  size_asc: "从小到大",
  name_asc: "名称 A→Z",
  name_desc: "名称 Z→A",
}

function isImageExt(ext: string): boolean {
  const e = ext.toLowerCase()
  return e === "jpg" || e === "jpeg" || e === "png" || e === "webp" || e === "gif"
}

function extGlyph(ext: string, category: ManagedFileItem["category"]): string {
  if (category === "novels" || ext === "epub" || ext === "txt") return "书"
  if (category === "manga" || ext === "cbz") return "漫"
  if (category === "ugoira" || ext === "mp4" || ext === "gif") return "动"
  if (category === "pixivision" || ext === "pdf") return "辑"
  if (ext === "zip") return "包"
  return "图"
}

function taskStatusLabel(status: DownloadTaskItem["status"]): string {
  switch (status) {
    case "running":
      return "进行中"
    case "queued":
      return "排队中"
    case "paused":
      return "已暂停"
    case "completed":
      return "已完成"
    case "failed":
      return "失败"
    case "canceled":
      return "已取消"
  }
}

export function DownloadManagerScreen({
  initialSection = "overview",
  category: initialCategory = "all",
  creatorFolder: initialCreatorFolder,
}: {
  initialSection?: SectionTab
  category?: DownloadFileCategory
  creatorFolder?: string
}) {
  const { colors, accent, accentSoft } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [section, setSection] = useState<SectionTab>(initialSection)
  const [selectedCategory, setSelectedCategory] = useState<DownloadFileCategory>(
    initialCategory === "creators" ? "all" : initialCategory,
  )
  const [selectedCreator, setSelectedCreator] = useState<string | null>(
    initialCreatorFolder ?? null,
  )
  const [creatorSubFilter, setCreatorSubFilter] = useState<
    "all" | "illustrations" | "ugoira" | "manga" | "novels"
  >("all")
  const [sortMode, setSortMode] = useState<SortMode>("date_desc")
  const [searchQuery, setSearchQuery] = useState("")

  const [overview, setOverview] = useState<StorageOverview | null>(null)
  const [tasks, setTasks] = useState<DownloadTaskItem[]>(() => DownloadTaskManager.getAllTasks())
  const [files, setFiles] = useState<ManagedFileItem[]>([])
  const [creators, setCreators] = useState<CreatorFolderItem[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fileRevision, setFileRevision] = useState(0)

  const rootDir = useMemo(() => {
    try {
      return getDownloadRootDirectory()
    } catch {
      return ""
    }
  }, [])

  // Subscribe to DownloadTaskManager live updates
  useEffect(() => {
    setTasks(DownloadTaskManager.getAllTasks())
    return DownloadTaskManager.addListener(() => {
      setTasks(DownloadTaskManager.getAllTasks())
    })
  }, [])

  // Subscribe to file system change notifications
  useEffect(() => {
    return addDownloadFilesChangeListener(() => {
      setFileRevision((v) => v + 1)
    })
  }, [])

  const loadSectionData = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true)
      else setLoadingData(true)
      try {
        if (section === "overview") {
          const ov = await getStorageOverview(force)
          setOverview(ov)
        } else if (section === "category") {
          const list = await scanCategoryFiles(selectedCategory, sortMode, searchQuery, force)
          setFiles(list)
        } else if (section === "creators") {
          if (selectedCreator) {
            const list = await scanCreatorFiles(
              selectedCreator,
              creatorSubFilter,
              sortMode,
              searchQuery,
              force,
            )
            setFiles(list)
          } else {
            const dirs = await scanCreatorDirectories(sortMode, searchQuery, force)
            setCreators(dirs)
          }
        }
      } catch (e: any) {
        overlay.showToast(e?.message ?? "读取本地文件失败", "error")
      } finally {
        setLoadingData(false)
        setRefreshing(false)
      }
    },
    [section, selectedCategory, selectedCreator, creatorSubFilter, sortMode, searchQuery, overlay],
  )

  useEffect(() => {
    if (section !== "tasks") {
      void loadSectionData(false)
    } else {
      setLoadingData(false)
    }
  }, [section, selectedCategory, selectedCreator, creatorSubFilter, sortMode, searchQuery, fileRevision, loadSectionData])

  const activeTaskCount = useMemo(
    () =>
      tasks.filter((t) => t.status === "running" || t.status === "queued" || t.status === "paused")
        .length,
    [tasks],
  )

  async function handleSortPicker() {
    const keys: SortMode[] = ["date_desc", "date_asc", "size_desc", "size_asc", "name_asc", "name_desc"]
    const idx = await overlay.presentActionSheet({
      title: "排序方式",
      actions: keys.map((k) => ({
        label: SORT_LABELS[k],
        checked: sortMode === k,
      })),
    })
    if (idx != null && keys[idx]) {
      setSortMode(keys[idx])
    }
  }

  async function handleCleanTemp() {
    const ok = await overlay.confirm({
      title: "清理临时缓存",
      message: `将清理下载导出产生的临时切片文件 (${overview?.formattedTempSize ?? "0 B"})，不会删除已完成的下载文件。`,
      confirmLabel: "清理",
      destructive: true,
    })
    if (!ok) return
    const freed = await cleanTempCache()
    overlay.showToast(`已释放 ${formatBytes(freed)} 临时空间`, "success")
    void loadSectionData(true)
  }

  async function handleFileActions(item: ManagedFileItem) {
    const actions: Array<{ label: string; destructive?: boolean; action: string }> = [
      { label: "分享 / 导出到其他应用", action: "share" },
    ]
    if (item.artworkId) {
      actions.push({ label: `跳转原作品 (#${item.artworkId})`, action: "jump" })
    }
    actions.push({ label: "重命名文件", action: "rename" })
    actions.push({ label: "删除文件", destructive: true, action: "delete" })

    const idx = await overlay.presentActionSheet({
      title: item.name,
      message: `${item.formattedSize} · ${item.formattedTime}`,
      actions: actions.map((a) => ({ label: a.label, destructive: a.destructive })),
    })
    if (idx == null) return
    const chosen = actions[idx]
    if (!chosen) return

    if (chosen.action === "share") {
      const ok = await shareFilesSystem([item.path])
      if (!ok) overlay.showToast("无法分享该文件，可能已被移动或删除", "error")
    } else if (chosen.action === "jump" && item.artworkId) {
      if (item.category === "novels") {
        nav.push({ name: "novel", id: item.artworkId })
      } else if (item.category === "pixivision") {
        nav.push({ name: "pixivision", id: item.artworkId })
      } else {
        nav.push({ name: "illust", id: item.artworkId })
      }
    } else if (chosen.action === "rename") {
      const nextName = await overlay.prompt({
        title: "重命名文件",
        defaultValue: item.name,
        placeholder: "输入新文件名",
        confirmLabel: "保存",
      })
      if (!nextName || !nextName.trim()) return
      const res = await renameManagedFile(item.path, nextName.trim())
      if (res.success) {
        overlay.showToast("文件已重命名", "success")
      } else {
        overlay.showToast(res.error ?? "重命名失败", "error")
      }
    } else if (chosen.action === "delete") {
      const ok = await overlay.confirm({
        title: "删除文件",
        message: `确定永久删除「${item.name}」吗？`,
        confirmLabel: "删除",
        destructive: true,
      })
      if (!ok) return
      const deleted = await deleteManagedFile(item.path)
      if (deleted) {
        overlay.showToast("已删除文件", "info")
      } else {
        overlay.showToast("删除失败", "error")
      }
    }
  }

  async function handleCreatorActions(folder: CreatorFolderItem) {
    const actions: Array<{ label: string; destructive?: boolean; action: string }> = [
      { label: "浏览该画师的本地文件", action: "open" },
    ]
    if (folder.authorId) {
      actions.push({ label: `打开画师主页 (UID ${folder.authorId})`, action: "profile" })
    }
    actions.push({ label: "删除整个画师目录", destructive: true, action: "delete" })

    const idx = await overlay.presentActionSheet({
      title: folder.authorName,
      message: `${folder.fileCount} 个文件 · ${folder.formattedSize}`,
      actions: actions.map((a) => ({ label: a.label, destructive: a.destructive })),
    })
    if (idx == null) return
    const chosen = actions[idx]
    if (!chosen) return

    if (chosen.action === "open") {
      setSelectedCreator(folder.name)
      setCreatorSubFilter("all")
      setSearchQuery("")
    } else if (chosen.action === "profile" && folder.authorId) {
      nav.push({ name: "user", id: folder.authorId })
    } else if (chosen.action === "delete") {
      const ok = await overlay.confirm({
        title: "删除创作者目录",
        message: `确定永久删除「${folder.authorName}」目录下的全部 ${folder.fileCount} 个文件吗？`,
        confirmLabel: "全部删除",
        destructive: true,
      })
      if (!ok) return
      const deleted = await deleteCreatorDirectory(folder.path)
      if (deleted) {
        overlay.showToast("已删除画师目录", "info")
      } else {
        overlay.showToast("删除失败", "error")
      }
    }
  }

  function renderFileItem({ item }: { item: ManagedFileItem }) {
    const showThumb = isImageExt(item.extension)
    const fileUri = item.path.startsWith("file://") ? item.path : `file://${item.path}`
    return (
      <Pressable
        onPress={() => void handleFileActions(item)}
        style={[
          styles.fileCard,
          { backgroundColor: colors.surface, borderColor: colors.glassBorder },
        ]}
      >
        {showThumb ? (
          <Image
            source={{ uri: fileUri }}
            style={[styles.fileThumb, { backgroundColor: colors.fill }]}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.fileThumb, { backgroundColor: accentSoft }]}>
            <Text style={[styles.fileGlyph, { color: accent }]}>
              {extGlyph(item.extension, item.category)}
            </Text>
            <Text style={[styles.fileExt, { color: accent }]}>
              {item.extension.toUpperCase() || "FILE"}
            </Text>
          </View>
        )}

        <View style={styles.fileBody}>
          <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={2}>
            {item.title || item.name}
          </Text>
          <Text style={[styles.fileMeta, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.formattedSize} · {item.formattedTime}
          </Text>
          {item.creatorFolder ? (
            <Text style={[styles.fileCreator, { color: colors.textTertiary }]} numberOfLines={1}>
              创作者：{item.creatorFolder}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={() => void shareFilesSystem([item.path])}
          hitSlop={8}
          style={[styles.shareMiniBtn, { backgroundColor: accentSoft }]}
        >
          <Text style={[styles.shareMiniText, { color: accent }]}>分享</Text>
        </Pressable>
      </Pressable>
    )
  }

  function renderTaskItem(task: DownloadTaskItem) {
    const pct = Math.round(Math.max(0, Math.min(1, task.progress)) * 100)
    const statusColor =
      task.status === "completed"
        ? colors.green
        : task.status === "failed"
          ? colors.danger
          : task.status === "paused"
            ? colors.orange
            : task.status === "canceled"
              ? colors.textTertiary
              : accent

    return (
      <View
        key={task.id}
        style={[
          styles.taskCard,
          { backgroundColor: colors.surface, borderColor: colors.glassBorder },
        ]}
      >
        <View style={styles.taskTop}>
          <View style={styles.taskTitleWrap}>
            <Text style={[styles.taskTitle, { color: colors.text }]} numberOfLines={1}>
              {task.title}
            </Text>
            {task.subtitle ? (
              <Text style={[styles.taskSub, { color: colors.textSecondary }]} numberOfLines={1}>
                {task.subtitle}
              </Text>
            ) : null}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {taskStatusLabel(task.status)}
            </Text>
          </View>
        </View>

        <View style={[styles.progressTrack, { backgroundColor: colors.fill }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: statusColor, width: `${pct}%` },
            ]}
          />
        </View>

        <View style={styles.taskMetaRow}>
          <Text style={[styles.taskStatusDesc, { color: colors.textSecondary }]} numberOfLines={1}>
            {task.statusText}
          </Text>
          <Text style={[styles.taskCountText, { color: colors.textTertiary }]}>
            {task.current}/{task.total} ({pct}%)
          </Text>
        </View>

        {task.errorMessage ? (
          <Text style={[styles.taskErr, { color: colors.danger }]} numberOfLines={2}>
            {task.errorMessage}
          </Text>
        ) : null}

        <View style={styles.taskActions}>
          {task.status === "running" || task.status === "queued" ? (
            <>
              <Pressable
                onPress={() => {
                  try {
                    triggerHaptic("selection")
                  } catch {}
                  void DownloadTaskManager.pauseTask(task.id)
                }}
                style={[styles.taskBtn, { backgroundColor: colors.fill }]}
              >
                <Text style={[styles.taskBtnText, { color: colors.text }]}>暂停</Text>
              </Pressable>
              <Pressable
                onPress={() => void DownloadTaskManager.cancelTask(task.id)}
                style={[styles.taskBtn, { backgroundColor: `${colors.danger}18` }]}
              >
                <Text style={[styles.taskBtnText, { color: colors.danger }]}>取消</Text>
              </Pressable>
            </>
          ) : null}

          {task.status === "paused" ? (
            <>
              <Pressable
                onPress={() => {
                  try {
                    triggerHaptic("selection")
                  } catch {}
                  void DownloadTaskManager.resumeTask(task.id)
                }}
                style={[styles.taskBtn, { backgroundColor: accent }]}
              >
                <Text style={[styles.taskBtnText, { color: "#FFFFFF" }]}>继续</Text>
              </Pressable>
              <Pressable
                onPress={() => void DownloadTaskManager.cancelTask(task.id)}
                style={[styles.taskBtn, { backgroundColor: `${colors.danger}18` }]}
              >
                <Text style={[styles.taskBtnText, { color: colors.danger }]}>取消</Text>
              </Pressable>
            </>
          ) : null}

          {task.status === "failed" || task.status === "canceled" ? (
            <>
              <Pressable
                onPress={async () => {
                  const ok = await DownloadTaskManager.retryTask(task.id)
                  if (!ok) {
                    overlay.showToast("该任务属于上次会话记录，无法直接续传，请重新发起下载", "info")
                  }
                }}
                style={[styles.taskBtn, { backgroundColor: accentSoft }]}
              >
                <Text style={[styles.taskBtnText, { color: accent }]}>重试</Text>
              </Pressable>
              <Pressable
                onPress={() => DownloadTaskManager.removeTask(task.id)}
                style={[styles.taskBtn, { backgroundColor: colors.fill }]}
              >
                <Text style={[styles.taskBtnText, { color: colors.textSecondary }]}>移除记录</Text>
              </Pressable>
            </>
          ) : null}

          {task.status === "completed" ? (
            <>
              {task.outputPath ? (
                <Pressable
                  onPress={() => void shareFilesSystem([task.outputPath!])}
                  style={[styles.taskBtn, { backgroundColor: accentSoft }]}
                >
                  <Text style={[styles.taskBtnText, { color: accent }]}>分享文件</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => DownloadTaskManager.removeTask(task.id)}
                style={[styles.taskBtn, { backgroundColor: colors.fill }]}
              >
                <Text style={[styles.taskBtnText, { color: colors.textSecondary }]}>移除记录</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <ScreenHeader
        title="下载与文件管理"
        showBack={nav.canGoBack}
        onBack={() => nav.pop()}
        right={
          section === "tasks" ? (
            <HeaderIconButton
              label="清理完成"
              onPress={() => {
                DownloadTaskManager.clearCompletedTasks()
                overlay.showToast("已清除已完成/已取消的任务记录", "info")
              }}
            />
          ) : section === "category" || section === "creators" ? (
            <HeaderIconButton label="排序" onPress={() => void handleSortPicker()} />
          ) : (
            <HeaderIconButton label="刷新" onPress={() => void loadSectionData(true)} />
          )
        }
        bottom={
          <View style={styles.topControls}>
            <SegmentedControl<SectionTab>
              value={section}
              onChange={(next) => {
                setSection(next)
                setSearchQuery("")
                if (next !== "creators") setSelectedCreator(null)
              }}
              options={[
                { value: "overview", label: "概览" },
                {
                  value: "tasks",
                  label: activeTaskCount > 0 ? `任务(${activeTaskCount})` : "任务",
                },
                { value: "category", label: "分类" },
                { value: "creators", label: "创作者" },
              ]}
            />

            {section === "category" ? (
              <ChipBar<DownloadFileCategory>
                items={CATEGORY_CHIPS}
                selected={selectedCategory}
                onSelect={setSelectedCategory}
                compact={true}
              />
            ) : null}

            {section === "creators" && selectedCreator ? (
              <View style={styles.creatorBreadcrumb}>
                <Pressable
                  onPress={() => {
                    setSelectedCreator(null)
                    setSearchQuery("")
                  }}
                  style={[styles.backPill, { backgroundColor: accentSoft }]}
                >
                  <Text style={[styles.backPillText, { color: accent }]}>‹ 返回创作者列表</Text>
                </Pressable>
                <Text style={[styles.creatorTitle, { color: colors.text }]} numberOfLines={1}>
                  {selectedCreator}
                </Text>
              </View>
            ) : null}

            {section === "creators" && selectedCreator ? (
              <ChipBar<"all" | "illustrations" | "ugoira" | "manga" | "novels">
                items={CREATOR_SUB_CHIPS}
                selected={creatorSubFilter}
                onSelect={setCreatorSubFilter}
                compact={true}
              />
            ) : null}

            {section === "category" || section === "creators" ? (
              <View style={styles.searchWrap}>
                <ThemedTextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder={
                    section === "creators" && !selectedCreator
                      ? "搜索创作者名称或 UID…"
                      : "搜索文件名、标题或作品 ID…"
                  }
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ) : null}
          </View>
        }
      />

      {section === "overview" ? (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadSectionData(true)}
              tintColor={accent}
              colors={[accent]}
            />
          }
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom: effectiveBottomInset(insets) + 28,
          }}
        >
          <SectionCard style={styles.overviewHero}>
            <Text style={[styles.overviewLabel, { color: colors.textSecondary }]}>
              已下载文件总占用
            </Text>
            <Text style={[styles.overviewSize, { color: accent }]}>
              {overview?.formattedTotalSize ?? "计算中…"}
            </Text>
            <Text style={[styles.overviewSub, { color: colors.textSecondary }]}>
              共 {overview?.totalFilesCount ?? 0} 个本地文件 · 临时缓存{" "}
              {overview?.formattedTempSize ?? "0 B"}
            </Text>
            {rootDir ? (
              <Text style={[styles.rootPath, { color: colors.textTertiary }]} numberOfLines={2}>
                存储路径：{rootDir}
              </Text>
            ) : null}
          </SectionCard>

          {activeTaskCount > 0 ? (
            <>
              <SectionHeader title={`进行中任务 (${activeTaskCount})`} />
              <View style={styles.taskPreviewWrap}>
                {tasks
                  .filter(
                    (t) => t.status === "running" || t.status === "queued" || t.status === "paused",
                  )
                  .slice(0, 2)
                  .map(renderTaskItem)}
              </View>
            </>
          ) : null}

          <SectionHeader title="按分类浏览" />
          <SectionCard>
            <SettingRow
              title="插画"
              icon="图"
              iconColor={accent}
              value={`${overview?.illustrationsCount ?? 0} 项 · ${formatBytes(overview?.illustrationsSize ?? 0)}`}
              showChevron={true}
              onPress={() => {
                setSelectedCategory("illustrations")
                setSection("category")
              }}
            />
            <SettingRow
              title="漫画"
              icon="漫"
              iconColor={colors.green}
              value={`${overview?.mangaCount ?? 0} 项 · ${formatBytes(overview?.mangaSize ?? 0)}`}
              showChevron={true}
              onPress={() => {
                setSelectedCategory("manga")
                setSection("category")
              }}
            />
            <SettingRow
              title="小说"
              icon="书"
              iconColor={colors.pink}
              value={`${overview?.novelsCount ?? 0} 项 · ${formatBytes(overview?.novelsSize ?? 0)}`}
              showChevron={true}
              onPress={() => {
                setSelectedCategory("novels")
                setSection("category")
              }}
            />
            <SettingRow
              title="动图 (Ugoira)"
              icon="动"
              iconColor={colors.orange}
              value={`${overview?.ugoiraCount ?? 0} 项 · ${formatBytes(overview?.ugoiraSize ?? 0)}`}
              showChevron={true}
              onPress={() => {
                setSelectedCategory("ugoira")
                setSection("category")
              }}
            />
            <SettingRow
              title="Pixivision 特辑"
              icon="辑"
              iconColor={colors.purple}
              value={`${overview?.pixivisionCount ?? 0} 项 · ${formatBytes(overview?.pixivisionSize ?? 0)}`}
              showChevron={true}
              onPress={() => {
                setSelectedCategory("pixivision")
                setSection("category")
              }}
            />
            <SettingRow
              title="按创作者目录浏览"
              icon="画"
              iconColor={accent}
              value={`${overview?.creatorsCount ?? 0} 位 · ${formatBytes(overview?.creatorsSize ?? 0)}`}
              showChevron={true}
              isLast={true}
              onPress={() => {
                setSelectedCreator(null)
                setSection("creators")
              }}
            />
          </SectionCard>

          <SectionHeader title="维护与清理" />
          <SectionCard style={styles.maintPad}>
            <ActionButton
              title={`清理临时导出缓存 (${overview?.formattedTempSize ?? "0 B"})`}
              variant="secondary"
              onPress={() => void handleCleanTemp()}
            />
          </SectionCard>
        </ScrollView>
      ) : section === "tasks" ? (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: effectiveBottomInset(insets) + 28,
            gap: 10,
          }}
        >
          {tasks.length === 0 ? (
            <EmptyView
              title="暂无下载任务"
              subtitle="在插画、漫画、动图或小说页面触发下载或导出时，实时进度会显示在这里。"
            />
          ) : (
            tasks.map(renderTaskItem)
          )}
        </ScrollView>
      ) : section === "creators" && !selectedCreator ? (
        loadingData && creators.length === 0 ? (
          <View style={styles.loadingCenter}>
            <ActivityIndicator size="large" color={accent} />
          </View>
        ) : (
          <FlashList
            data={creators}
            estimatedItemSize={84}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void loadSectionData(true)}
                tintColor={accent}
                colors={[accent]}
              />
            }
            contentContainerStyle={{
              paddingTop: 6,
              paddingBottom: effectiveBottomInset(insets) + 28,
            }}
            ListEmptyComponent={
              <EmptyView
                title="暂无创作者目录"
                subtitle="使用作者批量下载功能后，文件会按创作者目录自动归档。"
              />
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  setSelectedCreator(item.name)
                  setCreatorSubFilter("all")
                  setSearchQuery("")
                }}
                onLongPress={() => void handleCreatorActions(item)}
                style={[
                  styles.creatorCard,
                  { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                ]}
              >
                <View style={[styles.folderIcon, { backgroundColor: accentSoft }]}>
                  <Text style={[styles.folderIconText, { color: accent }]}>
                    {item.authorName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.fileBody}>
                  <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>
                    {item.authorName}
                  </Text>
                  <Text style={[styles.fileMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                    {item.fileCount} 个文件 · {item.formattedSize}
                  </Text>
                  <Text style={[styles.fileCreator, { color: colors.textTertiary }]} numberOfLines={1}>
                    插画 {item.subCounts.illustrations} · 漫画 {item.subCounts.manga} · 动图{" "}
                    {item.subCounts.ugoira} · 小说 {item.subCounts.novels}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void handleCreatorActions(item)}
                  hitSlop={8}
                  style={[styles.shareMiniBtn, { backgroundColor: colors.fill }]}
                >
                  <Text style={[styles.shareMiniText, { color: colors.textSecondary }]}>更多</Text>
                </Pressable>
              </Pressable>
            )}
          />
        )
      ) : loadingData && files.length === 0 ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      ) : (
        <FlashList
          data={files}
          estimatedItemSize={84}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadSectionData(true)}
              tintColor={accent}
              colors={[accent]}
            />
          }
          contentContainerStyle={{
            paddingTop: 6,
            paddingBottom: effectiveBottomInset(insets) + 28,
          }}
          ListEmptyComponent={
            <EmptyView
              title={searchQuery.trim() ? "没有匹配的文件" : "当前目录暂无文件"}
              subtitle="下载的作品、导出的 EPUB / CBZ / ZIP / MP4 文件会保存在此处。"
            />
          }
          renderItem={renderFileItem}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  topControls: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 6,
  },
  searchWrap: {
    paddingTop: 2,
  },
  creatorBreadcrumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 4,
  },
  backPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  backPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  creatorTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  overviewHero: {
    padding: 16,
    gap: 6,
  },
  overviewLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  overviewSize: {
    fontSize: 28,
    fontWeight: "800",
  },
  overviewSub: {
    fontSize: 13,
  },
  rootPath: {
    fontSize: 11,
    marginTop: 4,
  },
  taskPreviewWrap: {
    paddingHorizontal: 12,
    gap: 8,
  },
  maintPad: {
    padding: 12,
  },
  loadingCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginVertical: 5,
    padding: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 11,
  },
  fileThumb: {
    width: 54,
    height: 54,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  fileGlyph: {
    fontSize: 18,
    fontWeight: "800",
  },
  fileExt: {
    fontSize: 9,
    fontWeight: "700",
    marginTop: 1,
  },
  fileBody: {
    flex: 1,
    gap: 3,
  },
  fileName: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 19,
  },
  fileMeta: {
    fontSize: 12,
  },
  fileCreator: {
    fontSize: 11,
  },
  shareMiniBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  shareMiniText: {
    fontSize: 12,
    fontWeight: "600",
  },
  creatorCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginVertical: 5,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  folderIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  folderIconText: {
    fontSize: 18,
    fontWeight: "800",
  },
  taskCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 13,
    gap: 8,
  },
  taskTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  taskTitleWrap: {
    flex: 1,
    gap: 2,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  taskSub: {
    fontSize: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
  taskMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  taskStatusDesc: {
    flex: 1,
    fontSize: 12,
  },
  taskCountText: {
    fontSize: 12,
    fontWeight: "600",
  },
  taskErr: {
    fontSize: 12,
    lineHeight: 17,
  },
  taskActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  taskBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  taskBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
})
