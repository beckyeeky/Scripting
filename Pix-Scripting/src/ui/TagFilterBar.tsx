import {
  Button,
  FlowLayout,
  HStack,
  Text,
  VStack,
} from "scripting"
import { renderTagContextMenu } from "./components/TagChip"
import type { PixivBookmarkTag, PixivWebUserTag } from "../types"

type TagItem = PixivBookmarkTag | PixivWebUserTag

function tagNameOf(item: TagItem): string {
  return "tag" in item ? item.tag : item.name
}

function tagCountOf(item: TagItem): number {
  const value = "tag" in item ? item.cnt : item.count
  return typeof value === "number" ? value : 0
}

function tagTranslationOf(item: TagItem): string | undefined {
  if (
    "tag_translation" in item &&
    item.tag_translation &&
    item.tag_translation !== item.tag
  ) {
    return item.tag_translation
  }
  return undefined
}

/**
 * 全工程统一的标签筛选云（用户主页 / 用户收藏 / 图书馆三处共用）。
 * 数据源一律为网页接口（主页 = 作品标签，收藏 = 收藏分类标签），
 * 清洗规则与网页一致：「未分類」不展示；计数上屏。
 */
export function TagFilterBar(props: {
  tags: TagItem[]
  selectedTag: string | null
  onSelectTag: (tag: string | null) => void
}) {
  const { tags, selectedTag, onSelectTag } = props

  const cleanTags = (tags ?? []).filter((item) => {
    const name = tagNameOf(item)
    return Boolean(name && name !== "未分類" && name !== "未分类")
  })

  // 无标签时不占用垂直空间
  if (cleanTags.length === 0) return null

  return (
    <VStack
      alignment="leading"
      spacing={6}
      padding={{ horizontal: 8 }}
      frame={{ maxWidth: "infinity" }}
    >
      <Text
        font="subheadline"
        fontWeight="semibold"
        foregroundStyle="secondaryLabel"
      >
        标签
      </Text>
      <FlowLayout spacing={4}>
        {cleanTags.map((item) => {
          const name = tagNameOf(item)
          const translation = tagTranslationOf(item)
          const count = tagCountOf(item)
          const isSelected = selectedTag === name
          return (
            <Button
              key={name}
              action={() => {
                onSelectTag(isSelected ? null : name)
              }}
              buttonStyle={isSelected ? "borderedProminent" : "glass"}
              controlSize="small"
              fixedSize={{ horizontal: true, vertical: false }}
              contextMenu={renderTagContextMenu(name, translation)}
            >
              <HStack spacing={3} alignment="center">
                <Text
                  font="caption"
                  foregroundStyle={isSelected ? undefined : "#0096FA"}
                  fontWeight="semibold"
                >
                  #
                </Text>
                <Text
                  font="caption"
                  fontWeight={isSelected ? "semibold" : "regular"}
                  lineLimit={1}
                >
                  {name}
                </Text>
                {translation ? (
                  <Text
                    font="caption"
                    foregroundStyle={isSelected ? undefined : "secondaryLabel"}
                    lineLimit={1}
                  >
                    {translation}
                  </Text>
                ) : null}
                {count > 0 ? (
                  <Text
                    font="caption2"
                    foregroundStyle={isSelected ? undefined : "secondaryLabel"}
                    lineLimit={1}
                  >
                    {String(count)}
                  </Text>
                ) : null}
              </HStack>
            </Button>
          )
        })}
      </FlowLayout>
    </VStack>
  )
}
