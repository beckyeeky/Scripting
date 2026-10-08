import {
  Button,
  Group,
  HStack,
  Image,
  NavigationLink,
  Text,
  type Color,
} from "scripting"
import { AppNavigationLink } from "../DualRouteContext"
import { blockTag } from "../../store/blocklist"
import { TagPreview } from "./TagPreview"

export function renderTagContextMenu(tagName: string, translatedName?: string) {
  return {
    preview: <TagPreview tagName={tagName} translatedName={translatedName} />,
    menuItems: (
      <Group>
        <Button
          title="查看 Pixiv 百科"
          systemImage="book.pages"
          action={() => {
            const url = `https://dic.pixiv.net/a/${encodeURIComponent(tagName)}`
            void Safari.present(url, false)
          }}
        />
        <Button
          title="复制标签名"
          systemImage="doc.on.doc"
          action={() => {
            void Pasteboard.setString(tagName)
          }}
        />
        <Button
          title="屏蔽该标签"
          systemImage="nosign"
          role="destructive"
          action={() => blockTag(tagName)}
        />
      </Group>
    ),
  }
}

export function TagChip(props: {
  name: string
  tagName?: string
  translatedName?: string
  value: string
  compact?: boolean
}) {
  const { name, tagName = name, translatedName, value, compact = false } = props
  return (
    <AppNavigationLink
      value={value}
      buttonStyle="glass"
      controlSize={compact ? "mini" : "small"}
      fixedSize={{ horizontal: true, vertical: false }}
      contextMenu={renderTagContextMenu(tagName, translatedName)}
    >
      <HStack spacing={3} alignment="center">
        <Text
          font={compact ? "caption2" : "caption"}
          foregroundStyle="systemBlue"
          fontWeight="semibold"
        >
          #
        </Text>
        <Text font={compact ? "caption" : "body"} lineLimit={1}>
          {name}
        </Text>
        {translatedName ? (
          <Text
            font={compact ? "caption2" : "caption"}
            foregroundStyle="secondaryLabel"
            lineLimit={1}
          >
            {translatedName}
          </Text>
        ) : null}
      </HStack>
    </AppNavigationLink>
  )
}

export function SelectableTagChip(props: {
  name: string
  translatedName?: string
  selected: boolean
  accentColor?: Color
  compact?: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  const {
    name,
    translatedName,
    selected,
    accentColor = "systemBlue",
    compact = false,
    disabled = false,
    onToggle,
  } = props

  return (
    <Button
      buttonStyle={selected ? "glassProminent" : "glass"}
      tint={selected ? accentColor : undefined}
      controlSize={compact ? "mini" : "small"}
      fixedSize={{ horizontal: true, vertical: false }}
      disabled={disabled}
      action={onToggle}
    >
      <HStack spacing={3} alignment="center">
        {selected ? (
          <Image
            systemName="checkmark"
            font={compact ? "caption2" : "footnote"}
            fontWeight="bold"
          />
        ) : (
          <Text
            font={compact ? "caption2" : "footnote"}
            foregroundStyle="systemBlue"
            fontWeight="semibold"
          >
            #
          </Text>
        )}
        <Text font={compact ? "caption" : "subheadline"} lineLimit={1}>
          {name}
        </Text>
        {translatedName ? (
          <Text
            font={compact ? "caption2" : "footnote"}
            foregroundStyle={selected ? undefined : "secondaryLabel"}
            lineLimit={1}
          >
            {translatedName}
          </Text>
        ) : null}
      </HStack>
    </Button>
  )
}

