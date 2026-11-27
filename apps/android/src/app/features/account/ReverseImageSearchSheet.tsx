import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  Image,
  NativeModules,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import {
  searchImageBySauceNAO,
  type SauceNAOMatch,
  type SauceNAOResponse,
} from "../../../../../../Pix-Scripting/src/api/sauceNao"
import { triggerHaptic } from "../../../../../../Pix-Scripting/src/platform/haptics"
import {
  addSauceNaoApiKey,
  clearSauceNaoApiKey,
  getSauceNaoEntries,
  getSauceNaoQuotaStats,
  onSauceNaoKeyChanged,
  removeSauceNaoApiKey,
  type SauceNaoKeyEntry,
} from "../../../../../../Pix-Scripting/src/store/sauceNaoStore"
import { ScriptingPhotos, ScriptingSafari, ScriptingUIImage } from "../../../scripting/hostGlobals"
import {
  ActionButton,
  SectionCard,
  SectionHeader,
  ThemedTextInput,
} from "../../components"
import { useAppNav } from "../../navigation/NavContext"
import { useOverlay } from "../../overlay/OverlayHost"
import { effectiveBottomInset, useSafeInsets } from "../../theme/insets"
import { useAppTheme } from "../../theme/ThemeProvider"

function maskKey(key: string): string {
  const clean = key.trim()
  if (clean.length <= 10) return clean
  return `${clean.slice(0, 6)}••••${clean.slice(-4)}`
}

const PREVIEW_SCHEME = /^(file|content|https?):\/\//

function toPreviewUri(path: string): string {
  return PREVIEW_SCHEME.test(path) ? path : `file://${path}`
}

/**
 * Normalizes an image for `searchImageBySauceNAO`.
 *
 * The shared search helper assumes `preparingThumbnail` is synchronous (iOS host),
 * but the Android host implements it as async. Encoding a bounded JPEG through the
 * native image module first keeps the upload small and avoids that broken branch.
 */
function toSearchableImage(source: any): ScriptingUIImage | null {
  const filePath = typeof source === "string" ? source : source?.filePath
  if (!filePath) return null

  const nativeImage = (NativeModules as any)?.PixImageMedia
  if (nativeImage?.encodeImageToBase64Sync) {
    try {
      const base64 = nativeImage.encodeImageToBase64Sync(filePath, "jpeg", 82, 800)
      if (base64) {
        const encoded = ScriptingUIImage.fromBase64String(base64)
        if (encoded) return encoded
      }
    } catch {}
  }

  if (source instanceof ScriptingUIImage) return source
  return ScriptingUIImage.fromFile(filePath)
}

export function ReverseImageSearchSheet({
  onClose,
  initialImagePath,
}: {
  onClose: () => void
  initialImagePath?: string | null
}) {
  const { colors, accent, accentSoft, isDark } = useAppTheme()
  const insets = useSafeInsets()
  const nav = useAppNav()
  const overlay = useOverlay()

  const [entries, setEntries] = useState<SauceNaoKeyEntry[]>(() => getSauceNaoEntries())
  const [stats, setStats] = useState(() => getSauceNaoQuotaStats())
  const [showKeyManager, setShowKeyManager] = useState<boolean>(() => getSauceNaoEntries().length === 0)
  const [newKeyInput, setNewKeyInput] = useState("")

  const [selectedPreviewUri, setSelectedPreviewUri] = useState<string | null>(null)
  const [pendingSharedImage, setPendingSharedImage] = useState<ScriptingUIImage | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [response, setResponse] = useState<SauceNAOResponse | null>(null)
  const initialImageHandledRef = useRef<string | null>(null)
  const searchSeqRef = useRef(0)

  useEffect(() => {
    const sync = () => {
      setEntries(getSauceNaoEntries())
      setStats(getSauceNaoQuotaStats())
    }
    sync()
    return onSauceNaoKeyChanged(sync)
  }, [])

  // Preload images staged from an Android ACTION_SEND intent: show the preview,
  // then search immediately when a key exists (or explain what is missing).
  useEffect(() => {
    const path = typeof initialImagePath === "string" ? initialImagePath.trim() : ""
    if (!path || initialImageHandledRef.current === path) return
    initialImageHandledRef.current = path

    setSelectedPreviewUri(toPreviewUri(path))
    setPendingSharedImage(null)
    setResponse(null)
    setSearchError(null)

    const image = toSearchableImage(path)
    if (!image) {
      setSearchError("无法读取分享的图片（可能已被清理或格式不受支持），请重新分享或从相册选择。")
      return
    }
    setPendingSharedImage(image)

    if (getSauceNaoEntries().length === 0) {
      setShowKeyManager(true)
      setSearchError("已载入分享的图片，请先添加 SauceNAO API Key 后再检索。")
      return
    }
    void runSearch(image)
  }, [initialImagePath])

  function handleAddKey() {
    const raw = newKeyInput.trim()
    if (!raw) return
    const added = addSauceNaoApiKey(raw)
    if (!added) {
      overlay.showToast("该 API Key 已存在或无效", "info")
      return
    }
    setNewKeyInput("")
    setEntries(getSauceNaoEntries())
    setStats(getSauceNaoQuotaStats())
    overlay.showToast("已添加 SauceNAO API Key", "success")

    // A shared image is already waiting: adding the first key can search it directly.
    const pending = pendingSharedImage
    if (pending && !searching && !response) {
      void runSearch(pending)
    }
  }

  async function handleClearAllKeys() {
    const ok = await overlay.confirm({
      title: "清空所有 SauceNAO 密钥",
      message: "将移除本地保存的全部 SauceNAO API Keys。",
      confirmLabel: "清空",
      destructive: true,
    })
    if (!ok) return
    clearSauceNaoApiKey()
    setEntries([])
    setStats(getSauceNaoQuotaStats())
    overlay.showToast("已清空密钥", "info")
  }

  async function runSearch(image: ScriptingUIImage) {
    const seq = ++searchSeqRef.current
    setSearchError(null)
    setSearching(true)
    setResponse(null)
    try {
      triggerHaptic("light")
    } catch {}

    try {
      const res = await searchImageBySauceNAO(image)
      if (seq !== searchSeqRef.current) return
      setResponse(res)
      setEntries(getSauceNaoEntries())
      setStats(getSauceNaoQuotaStats())
      if (res.results.length === 0) {
        setSearchError("未找到相似作品，请尝试换一张更清晰的图。")
      }
    } catch (e: any) {
      if (seq !== searchSeqRef.current) return
      const msg = e?.message ?? String(e)
      if (msg === "NEED_API_KEY") {
        setShowKeyManager(true)
        setSearchError("请先配置有效的 SauceNAO API Key。")
      } else {
        setSearchError(msg)
      }
      setEntries(getSauceNaoEntries())
      setStats(getSauceNaoQuotaStats())
    } finally {
      if (seq === searchSeqRef.current) setSearching(false)
    }
  }

  async function handlePickAndSearch() {
    if (searching) return
    if (getSauceNaoEntries().length === 0) {
      setShowKeyManager(true)
      setSearchError("请先添加一个 SauceNAO API Key 后再进行搜图。")
      return
    }

    let picked: ScriptingUIImage[] = []
    try {
      picked = await ScriptingPhotos.pickPhotos(1)
    } catch (e: any) {
      setSearchError(`无法打开相册或读取所选图片：${e?.message ?? String(e)}`)
      return
    }
    if (!picked || picked.length === 0) return

    const image = toSearchableImage(picked[0])
    if (!image) {
      setSelectedPreviewUri(null)
      setSearchError("无法读取所选图片（格式不受支持），请换一张图片重试。")
      return
    }

    setSelectedPreviewUri(picked[0].filePath ? toPreviewUri(picked[0].filePath) : null)
    setPendingSharedImage(null)
    await runSearch(image)
  }

  function openArtwork(pixivId: number) {
    onClose()
    nav.push({ name: "illust", id: pixivId })
  }

  function openAuthor(authorId: number) {
    onClose()
    nav.push({ name: "user", id: authorId })
  }

  function openExternalUrl(url: string) {
    void ScriptingSafari.openURL(url)
  }

  const results: SauceNAOMatch[] = response?.results ?? []

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingBottom: effectiveBottomInset(insets) + 28 },
      ]}
    >
      {/* Top Action & Preview Card */}
      <SectionCard style={styles.cardPad}>
        <View style={styles.topSummary}>
          <View style={styles.topTextWrap}>
            <Text style={[styles.heroTitle, { color: colors.text }]}>SauceNAO 以图搜图</Text>
            <Text style={[styles.heroSub, { color: colors.textSecondary }]}>
              {stats.keyCount > 0
                ? `已配置 ${stats.keyCount} 个密钥 · 今日已用 ${stats.used} / ${stats.total}`
                : "未配置 API Key · 支持多密钥自动故障转移"}
            </Text>
          </View>
          <Pressable
            onPress={() => setShowKeyManager((v) => !v)}
            style={[styles.pillBtn, { backgroundColor: accentSoft }]}
          >
            <Text style={[styles.pillBtnText, { color: accent }]}>
              {showKeyManager ? "收起密钥" : "管理密钥"}
            </Text>
          </Pressable>
        </View>

        {selectedPreviewUri ? (
          <View style={[styles.previewWrap, { backgroundColor: colors.fill }]}>
            <Image
              source={{ uri: selectedPreviewUri }}
              style={styles.previewImg}
              resizeMode="contain"
            />
          </View>
        ) : null}

        <ActionButton
          title={
            searching
              ? "正在识别并溯源…"
              : pendingSharedImage
                ? "检索分享的图片"
                : "从相册选择图片搜图"
          }
          onPress={() =>
            void (pendingSharedImage ? runSearch(pendingSharedImage) : handlePickAndSearch())
          }
          loading={searching}
        />

        {pendingSharedImage ? (
          <Pressable
            onPress={() => void handlePickAndSearch()}
            disabled={searching}
            style={[styles.switchImageBtn, searching && { opacity: 0.45 }]}
          >
            <Text style={[styles.switchImageText, { color: accent }]}>改从相册选择图片</Text>
          </Pressable>
        ) : null}
      </SectionCard>

      {/* Multi-Key Manager */}
      {showKeyManager ? (
        <>
          <SectionHeader
            title="API Key 密钥池"
            right={
              <Pressable
                onPress={() => void ScriptingSafari.openURL("https://saucenao.com/user.php?page=search-api")}
              >
                <Text style={[styles.linkText, { color: accent }]}>获取免费 Key</Text>
              </Pressable>
            }
          />
          <SectionCard style={styles.cardPad}>
            <View style={styles.addKeyRow}>
              <ThemedTextInput
                value={newKeyInput}
                onChangeText={setNewKeyInput}
                placeholder="输入 SauceNAO API Key"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.flexInput}
                onSubmitEditing={handleAddKey}
              />
              <Pressable
                onPress={handleAddKey}
                disabled={!newKeyInput.trim()}
                style={[
                  styles.addBtn,
                  { backgroundColor: accent },
                  !newKeyInput.trim() && { opacity: 0.45 },
                ]}
              >
                <Text style={styles.addBtnText}>添加</Text>
              </Pressable>
            </View>

            {entries.length === 0 ? (
              <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                SauceNAO 免费账号每日提供 100 次查询，可添加多个 API Key，在额度耗尽 (HTTP 429) 时自动轮换。
              </Text>
            ) : (
              <View style={styles.keyList}>
                {entries.map((entry, idx) => {
                  const limit = entry.limit ?? 100
                  const rem = typeof entry.remaining === "number" ? entry.remaining : null
                  return (
                    <View
                      key={entry.key}
                      style={[
                        styles.keyRow,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.separator,
                        },
                      ]}
                    >
                      <View style={styles.keyInfo}>
                        <Text style={[styles.keyCode, { color: colors.text }]}>
                          #{idx + 1} {maskKey(entry.key)}
                        </Text>
                        <Text style={[styles.keyQuota, { color: colors.textSecondary }]}>
                          {rem !== null ? `今日剩余 ${rem} / ${limit}` : `每日额度 ${limit}（待查询）`}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => {
                          removeSauceNaoApiKey(entry.key)
                          setEntries(getSauceNaoEntries())
                          setStats(getSauceNaoQuotaStats())
                        }}
                        hitSlop={8}
                        style={[styles.delBtn, { backgroundColor: `${colors.danger}18` }]}
                      >
                        <Text style={[styles.delBtnText, { color: colors.danger }]}>删除</Text>
                      </Pressable>
                    </View>
                  )
                })}
                {entries.length > 1 ? (
                  <Pressable onPress={() => void handleClearAllKeys()} style={styles.clearKeysBtn}>
                    <Text style={[styles.clearKeysText, { color: colors.danger }]}>清空全部密钥</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </SectionCard>
        </>
      ) : null}

      {/* Error */}
      {searchError ? (
        <View
          style={[
            styles.errorCard,
            {
              backgroundColor: isDark ? "rgba(255,69,58,0.16)" : "#FEF2F2",
              borderColor: colors.danger,
            },
          ]}
        >
          <Text style={[styles.errorText, { color: isDark ? "#FCA5A5" : "#991B1B" }]}>
            {searchError}
          </Text>
        </View>
      ) : null}

      {/* Loading */}
      {searching ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            正在检索 SauceNAO 与 Booru 溯源原画…
          </Text>
        </View>
      ) : null}

      {/* Results */}
      {results.length > 0 ? (
        <>
          <SectionHeader
            title={`匹配结果 (${results.length})`}
            right={
              response?.header?.long_remaining != null ? (
                <Text style={[styles.quotaHint, { color: colors.textSecondary }]}>
                  剩余 {response.header.long_remaining} 次
                </Text>
              ) : null
            }
          />
          <View style={styles.resultList}>
            {results.map((match, idx) => {
              const simColor =
                match.similarity >= 80
                  ? colors.green
                  : match.similarity >= 60
                    ? colors.orange
                    : colors.textSecondary
              return (
                <View
                  key={`${match.pixivId ?? "ext"}-${idx}`}
                  style={[
                    styles.resultCard,
                    { backgroundColor: colors.surface, borderColor: colors.glassBorder },
                  ]}
                >
                  <View style={styles.resultTop}>
                    {match.thumbnailUrl ? (
                      <Image
                        source={{ uri: match.thumbnailUrl }}
                        style={[styles.resultThumb, { backgroundColor: colors.fill }]}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={[styles.resultThumb, { backgroundColor: colors.fill }]} />
                    )}

                    <View style={styles.resultMeta}>
                      <View style={styles.simRow}>
                        <View style={[styles.simBadge, { backgroundColor: `${simColor}20` }]}>
                          <Text style={[styles.simText, { color: simColor }]}>
                            {match.similarity.toFixed(1)}%
                          </Text>
                        </View>
                        {match.pixivId ? (
                          <View style={[styles.simBadge, { backgroundColor: accentSoft }]}>
                            <Text style={[styles.simText, { color: accent }]}>
                              Pixiv #{match.pixivId}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={[styles.resultTitle, { color: colors.text }]} numberOfLines={2}>
                        {match.title}
                      </Text>

                      {match.authorName ? (
                        <Text style={[styles.resultSub, { color: colors.textSecondary }]} numberOfLines={1}>
                          画师：{match.authorName}
                        </Text>
                      ) : null}

                      {match.extraInfo || match.indexName ? (
                        <Text style={[styles.resultIdx, { color: colors.textTertiary }]} numberOfLines={1}>
                          {match.extraInfo ? `${match.extraInfo} · ` : ""}
                          {match.indexName}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.resultActions}>
                    {match.pixivId ? (
                      <Pressable
                        onPress={() => openArtwork(match.pixivId!)}
                        style={[styles.resBtnPrimary, { backgroundColor: accent }]}
                      >
                        <Text style={styles.resBtnPrimaryText}>打开 Pixiv 作品</Text>
                      </Pressable>
                    ) : null}
                    {match.authorId ? (
                      <Pressable
                        onPress={() => openAuthor(match.authorId!)}
                        style={[styles.resBtnSecondary, { backgroundColor: colors.fill }]}
                      >
                        <Text style={[styles.resBtnSecondaryText, { color: colors.text }]}>
                          画师主页
                        </Text>
                      </Pressable>
                    ) : null}
                    {match.extUrls.length > 0 ? (
                      <Pressable
                        onPress={() => openExternalUrl(match.extUrls[0])}
                        style={[styles.resBtnSecondary, { backgroundColor: colors.fill }]}
                      >
                        <Text style={[styles.resBtnSecondaryText, { color: colors.textSecondary }]}>
                          查看外链
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )
            })}
          </View>
        </>
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 10,
  },
  cardPad: {
    padding: 14,
    gap: 12,
  },
  topSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  topTextWrap: {
    flex: 1,
    gap: 3,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  heroSub: {
    fontSize: 12,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillBtnText: {
    fontSize: 12,
    fontWeight: "700",
  },
  previewWrap: {
    height: 150,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImg: {
    width: "100%",
    height: "100%",
  },
  linkText: {
    fontSize: 12,
    fontWeight: "600",
  },
  addKeyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  flexInput: {
    flex: 1,
  },
  addBtn: {
    paddingHorizontal: 14,
    height: 42,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  switchImageBtn: {
    alignSelf: "center",
    paddingVertical: 2,
  },
  switchImageText: {
    fontSize: 13,
    fontWeight: "600",
  },
  hintText: {
    fontSize: 12,
    lineHeight: 18,
  },
  keyList: {
    gap: 4,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    gap: 10,
  },
  keyInfo: {
    flex: 1,
    gap: 2,
  },
  keyCode: {
    fontSize: 13,
    fontWeight: "600",
  },
  keyQuota: {
    fontSize: 11,
  },
  delBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  delBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  clearKeysBtn: {
    alignSelf: "flex-end",
    paddingTop: 6,
  },
  clearKeysText: {
    fontSize: 12,
    fontWeight: "600",
  },
  errorCard: {
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 19,
  },
  loadingWrap: {
    alignItems: "center",
    paddingVertical: 28,
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
  },
  quotaHint: {
    fontSize: 12,
  },
  resultList: {
    paddingHorizontal: 12,
    gap: 10,
  },
  resultCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  resultTop: {
    flexDirection: "row",
    gap: 12,
  },
  resultThumb: {
    width: 78,
    height: 78,
    borderRadius: 10,
  },
  resultMeta: {
    flex: 1,
    gap: 4,
  },
  simRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  simBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  simText: {
    fontSize: 11,
    fontWeight: "700",
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },
  resultSub: {
    fontSize: 12,
  },
  resultIdx: {
    fontSize: 11,
  },
  resultActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  resBtnPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
  },
  resBtnPrimaryText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  resBtnSecondary: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
  },
  resBtnSecondaryText: {
    fontSize: 12,
    fontWeight: "600",
  },
})
