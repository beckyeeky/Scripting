import {
  Button,
  FlowLayout,
  HStack,
  Image,
  NavigationStack,
  RoundedRectangle,
  ScrollView,
  Text,
  VStack,
  useCallback,
  useState,
} from "scripting"
import { appGlass } from "./glass"
import { sheetDetents, sheetTopBar } from "./pageChrome"
import { AvatarImage } from "./CachedImage"
import { SelectableTagChip } from "./TagChip"
import {
  blockUser,
  isUserBlocked,
  loadBlocklist,
  updateBlocklist,
} from "../../store/blocklist"
import type { PixivTag, PixivUser } from "../../types"
import { triggerHaptic } from "../../platform/haptics"

export function BlockWorkSheet(props: {
  user?:
    | PixivUser
    | {
        id: number
        name: string
        account?: string
        avatarURL?: string
        profile_image_urls?: { medium?: string }
      }
    | null
  tags?: PixivTag[]
  onClose: () => void
}) {
  const { user, tags = [], onClose } = props

  const blocklist = loadBlocklist()
  const initialUserBlocked = user
    ? isUserBlocked(user.id, blocklist.blockedUsers)
    : false
  const [blockUserSelected, setBlockUserSelected] = useState(initialUserBlocked)

  const [selectedTags, setSelectedTags] = useState<Set<string>>(() => new Set<string>())

  const avatarURL =
    user && "profile_image_urls" in user && user.profile_image_urls?.medium
      ? user.profile_image_urls.medium
      : user && "avatarURL" in user && (user as any).avatarURL
        ? (user as any).avatarURL
        : null

  const toggleTag = useCallback((rawName: string) => {
    const name = rawName.trim()
    if (!name) return
    triggerHaptic("selection")
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }, [])

  const toggleUser = useCallback(() => {
    triggerHaptic("selection")
    setBlockUserSelected((prev) => !prev)
  }, [])

  // 必须点击确认按钮才确认屏蔽
  const handleConfirm = useCallback(() => {
    const current = loadBlocklist()
    let changed = false

    // 1. 处理用户屏蔽
    if (user) {
      const isAlreadyBlocked = isUserBlocked(user.id, current.blockedUsers)
      if (blockUserSelected && !isAlreadyBlocked) {
        blockUser(user)
        changed = true
      }
    }

    // 2. 处理标签屏蔽
    const currentTagSet = new Set(current.blockedTags)
    const mergedTags = [...current.blockedTags]
    for (const tag of selectedTags) {
      if (!currentTagSet.has(tag)) {
        mergedTags.push(tag)
        currentTagSet.add(tag)
        changed = true
      }
    }

    if (changed) {
      updateBlocklist({ blockedTags: mergedTags })
      triggerHaptic("medium")
    }

    onClose()
  }, [user, blockUserSelected, selectedTags, onClose])

  const validTags = tags.filter((t) => t && t.name && t.name.trim())

  return (
    <NavigationStack
      presentationDetents={sheetDetents()}
      presentationDragIndicator="visible"
    >
      <VStack
        alignment="leading"
        spacing={0}
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        {...sheetTopBar()}
        navigationTitle="屏蔽设置"
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          topBarLeading: (
            <Button action={onClose}>
              <Image systemName="xmark" font="headline" />
            </Button>
          ),
          topBarTrailing: (
            <Button action={handleConfirm}>
              <Image
                systemName="checkmark"
                font="headline"
                foregroundStyle="systemRed"
              />
            </Button>
          ),
        }}
      >
        <ScrollView frame={{ maxWidth: "infinity" }}>
          <VStack
            alignment="leading"
            spacing={12}
            padding={{ horizontal: 8, bottom: 24 }}
            frame={{ maxWidth: "infinity" }}
          >
            {/* 用户屏蔽分区 */}
            {user ? (
              <VStack
                alignment="leading"
                spacing={6}
                frame={{ maxWidth: "infinity" }}
              >
                <Text
                  font="caption"
                  fontWeight="semibold"
                  foregroundStyle="secondaryLabel"
                  padding={{ horizontal: 4 }}
                >
                  屏蔽用户
                </Text>
                <Button
                  action={toggleUser}
                  buttonStyle="plain"
                  frame={{ maxWidth: "infinity" }}
                  contentShape={{ type: "rect", cornerRadius: 12 }}
                >
                  <HStack
                    alignment="center"
                    spacing={12}
                    padding={{ horizontal: 14, vertical: 12 }}
                    frame={{ maxWidth: "infinity", alignment: "leading" }}
                    contentShape={{ type: "rect", cornerRadius: 12 }}
                    clipShape={{ type: "rect", cornerRadius: 12 }}
                    background={
                      blockUserSelected ? (
                        <RoundedRectangle cornerRadius={12} fill="systemRed" />
                      ) : undefined
                    }
                    glassEffect={
                      blockUserSelected
                        ? undefined
                        : appGlass({ type: "rect", cornerRadius: 12 })
                    }
                  >
                    {blockUserSelected ? (
                      <Image
                        systemName="checkmark"
                        font="subheadline"
                        fontWeight="bold"
                        foregroundStyle="white"
                      />
                    ) : null}
                    <AvatarImage url={avatarURL} size={36} />
                    <VStack
                      alignment="leading"
                      spacing={2}
                      frame={{ maxWidth: "infinity", alignment: "leading" }}
                    >
                      <Text
                        font="body"
                        fontWeight={blockUserSelected ? "semibold" : "regular"}
                        foregroundStyle={blockUserSelected ? "white" : "label"}
                      >
                        {user.name}
                      </Text>
                      <Text
                        font="caption"
                        foregroundStyle={
                          blockUserSelected
                            ? "rgba(255,255,255,0.78)"
                            : "secondaryLabel"
                        }
                      >
                        {`UID: ${user.id}${user.account ? ` · @${user.account}` : ""}`}
                      </Text>
                    </VStack>
                  </HStack>
                </Button>
              </VStack>
            ) : null}

            {/* 标签屏蔽分区 */}
            {validTags.length > 0 ? (
              <VStack
                alignment="leading"
                spacing={6}
                frame={{ maxWidth: "infinity" }}
              >
                <Text
                  font="caption"
                  fontWeight="semibold"
                  foregroundStyle="secondaryLabel"
                  padding={{ horizontal: 4 }}
                >
                  屏蔽标签
                </Text>
                <FlowLayout spacing={4}>
                  {validTags.map((tag) => {
                    const tagName = tag.name.trim()
                    const isSelected = selectedTags.has(tagName)
                    return (
                      <SelectableTagChip
                        key={tagName}
                        name={tagName}
                        translatedName={tag.translated_name ?? undefined}
                        selected={isSelected}
                        accentColor="systemRed"
                        onToggle={() => toggleTag(tagName)}
                      />
                    )
                  })}
                </FlowLayout>
              </VStack>
            ) : null}
          </VStack>
        </ScrollView>
      </VStack>
    </NavigationStack>
  )
}
