import {
  useEffect,
  useState,
  Text,
  VStack,
} from "scripting"
import { ConnectionRow } from "../components/ConnectionRow"
import { session } from "../../api/session"
import { userWorks } from "../../api/pixiv"
import { cardThumbUrlOf, prefetch } from "../../image/imageLoader"
import type { PixivIllustration, PixivUser, PixivUserPreview } from "../../types"

export interface IllustAuthorCardProps {
  user: PixivUser
  currentWorkID: number
  illustType?: "illust" | "manga" | "ugoira"
  priority?: number
  isSprint?: boolean
}

/**
 * 插画详情页作者展示卡片
 * 复用 ConnectionRow 视觉规范（毛玻璃底板、头像、昵称、@账号、圆形关注切换），
 * 首帧先画出 3 个纯净占位灰框避免布局跳动，后台异步拉取该画师的其他代表作并平滑淡入。
 */
export function IllustAuthorCard(props: IllustAuthorCardProps) {
  const {
    user,
    currentWorkID,
    illustType = "illust",
    priority,
    isSprint,
  } = props

  const [illusts, setIllusts] = useState<PixivIllustration[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ok = true
    setLoading(true)
    const type = illustType === "manga" ? "manga" : "illust"
    void session.call((t: string) => userWorks(user.id, type, t)).then(async (r) => {
      if (!ok) return
      let list = (r.items ?? []).filter((it: PixivIllustration) => it.id !== currentWorkID)
      if (!list.length && type === "illust") {
        const mr = await session.call((t: string) => userWorks(user.id, "manga", t)).catch(() => null)
        if (mr) list = (mr.items ?? []).filter((it: PixivIllustration) => it.id !== currentWorkID)
      }
      if (!ok) return
      setIllusts(list)
      setLoading(false)
      if (list.length) prefetch(list.slice(0, 3).map(cardThumbUrlOf))
    }).catch(() => {
      if (ok) setLoading(false)
    })
    return () => { ok = false }
  }, [user.id, illustType, currentWorkID])

  const preview: PixivUserPreview = { user, illusts, is_muted: false }

  return (
    <VStack
      alignment="leading"
      spacing={8}
      padding={{ horizontal: 14 }}
      frame={{ maxWidth: "infinity", alignment: "leading" }}
    >
      <Text font="subheadline" fontWeight="semibold" foregroundStyle="secondaryLabel">
        创作者
      </Text>
      <ConnectionRow
        preview={preview}
        loading={loading}
        priority={priority}
        isSprint={isSprint}
      />
    </VStack>
  )
}
