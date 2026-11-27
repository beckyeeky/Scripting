import React from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"
import { triggerHaptic } from "../../../../../Pix-Scripting/src/platform/haptics"
import {
  AboutScreen,
  BlocklistScreen,
  CustomAISettingsScreen,
  DownloadManagerScreen,
  HistoryAnalyticsScreen,
  HistoryScreen,
  LibraryScreen,
  MoreScreen,
  NotificationsScreen,
  RankingCustomPickerScreen,
  SettingsScreen,
} from "../features/account"
import {
  DiscoveryScreen,
  FollowFeedScreen,
  RankingScreen,
  SearchScreen,
} from "../features/feeds"
import {
  IllustDetailScreen,
  IllustGalleryScreen,
  PixivisionDetailScreen,
  RelatedFeedScreen,
  SeriesDetailScreen,
  TagFeedScreen,
  UserBookmarksScreen,
  UserConnectionsScreen,
  UserDetailScreen,
  UserWorksScreen,
} from "../features/media"
import {
  NovelDetailScreen,
  NovelLibraryScreen,
  NovelReaderScreen,
} from "../features/novel"
import { NotFoundScreen } from "../screens/NotFoundScreen"
import { useSafeInsets } from "../theme/insets"
import { useAppTheme } from "../theme/ThemeProvider"
import { useAppNav } from "./NavContext"
import { TABS, type Route, type TabId } from "./types"

function renderTabRoot(tab: TabId): React.ReactNode {
  switch (tab) {
    case "discovery":
      return <DiscoveryScreen />
    case "ranking":
      return <RankingScreen />
    case "following":
      return <FollowFeedScreen />
    case "more":
      return <MoreScreen />
    case "search":
      return <SearchScreen />
  }
}

function renderRouteScreen(route: Route): React.ReactNode {
  switch (route.name) {
    case "illust":
      return <IllustDetailScreen illustID={route.id} seed={route.seed} />
    case "illustGallery":
      return (
        <IllustGalleryScreen
          illust={route.illust}
          initialPage={route.initialPage}
          customImages={route.customImages}
        />
      )
    case "novel":
      return <NovelDetailScreen novelID={route.id} seed={route.seed} />
    case "novelReader":
      return <NovelReaderScreen {...route} />
    case "user":
      return <UserDetailScreen userID={route.id} seed={route.seed} />
    case "userWorks":
      return <UserWorksScreen userId={route.userId} title={route.title} />
    case "userBookmarks":
      return <UserBookmarksScreen userId={route.userId} />
    case "userConnections":
      return (
        <UserConnectionsScreen
          kind={route.kind}
          userId={route.userId}
          title={route.title}
        />
      )
    case "pixivision":
      return <PixivisionDetailScreen articleID={route.id} seed={route.seed} />
    case "series":
      return <SeriesDetailScreen kind={route.kind} seriesID={route.id} />
    case "tagFeed":
      return <TagFeedScreen tag={route.tag} kind={route.kind} />
    case "relatedIllust":
      return <RelatedFeedScreen kind="illust" id={route.id} />
    case "relatedNovel":
      return <RelatedFeedScreen kind="novel" id={route.id} />
    case "library":
      return <LibraryScreen initialKind={route.initialKind} />
    case "novelLibrary":
      return <NovelLibraryScreen />
    case "history":
      return <HistoryScreen />
    case "historyAnalytics":
      return <HistoryAnalyticsScreen initialScope={route.initialScope} />
    case "notifications":
      return <NotificationsScreen />
    case "notificationsMore":
      return <NotificationsScreen moreNotificationID={route.id} />
    case "downloadManager":
      return (
        <DownloadManagerScreen
          initialSection={route.initialSection}
          category={route.category}
          creatorFolder={route.creatorFolder}
        />
      )
    case "settings":
      return <SettingsScreen />
    case "customAI":
      return <CustomAISettingsScreen />
    case "blocklist":
      return <BlocklistScreen />
    case "rankingCustomPicker":
      return <RankingCustomPickerScreen kind={route.kind} />
    case "about":
      return <AboutScreen />
    case "notFound":
      return <NotFoundScreen rawRoute={route.rawRoute} />
  }
}

export function AppShell() {
  const { colors, accent } = useAppTheme()
  const insets = useSafeInsets()
  const { activeTab, stacks, visitedTabs, selectTab } = useAppNav()

  const activeStack = stacks[activeTab]
  const showTabBar = activeStack.length === 0

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.stage}>
        {TABS.map((tab) => {
          if (!visitedTabs.has(tab.id)) return null
          const isTabActive = activeTab === tab.id
          const tabStack = stacks[tab.id]
          return (
            <View
              key={tab.id}
              style={[
                StyleSheet.absoluteFill,
                { display: isTabActive ? "flex" : "none" },
              ]}
              pointerEvents={isTabActive ? "auto" : "none"}
            >
              {/* Tab Root Screen */}
              <View
                style={[
                  styles.screenLayer,
                  { display: tabStack.length === 0 ? "flex" : "none" },
                ]}
                pointerEvents={tabStack.length === 0 ? "auto" : "none"}
              >
                {renderTabRoot(tab.id)}
              </View>

              {/* Per-Tab Pushed Stack Screens (kept mounted so scroll state survives back pops) */}
              {tabStack.map((entry, idx) => {
                const isTop = idx === tabStack.length - 1
                return (
                  <View
                    key={entry.key}
                    style={[
                      StyleSheet.absoluteFill,
                      {
                        backgroundColor: colors.bg,
                        display: isTop ? "flex" : "none",
                      },
                    ]}
                    pointerEvents={isTop ? "auto" : "none"}
                  >
                    {renderRouteScreen(entry.route)}
                  </View>
                )
              })}
            </View>
          )
        })}
      </View>

      {showTabBar ? (
        <View
          style={[
            styles.tabBar,
            {
              backgroundColor: colors.glassBg,
              borderTopColor: colors.separator,
              paddingBottom: Math.max(insets.bottom, 6),
              paddingLeft: insets.left,
              paddingRight: insets.right,
            },
          ]}
        >
          {TABS.map((tab) => {
            const selected = activeTab === tab.id
            return (
              <Pressable
                key={tab.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={tab.title}
                onPress={() => {
                  try {
                    triggerHaptic("selection")
                  } catch {}
                  selectTab(tab.id)
                }}
                style={styles.tabItem}
              >
                <Text
                  style={[
                    styles.tabGlyph,
                    { color: selected ? accent : colors.textSecondary },
                  ]}
                >
                  {selected ? tab.activeGlyph : tab.glyph}
                </Text>
                <Text
                  style={[
                    styles.tabLabel,
                    { color: selected ? accent : colors.textSecondary },
                    selected && styles.tabLabelActive,
                  ]}
                  numberOfLines={1}
                >
                  {tab.title}
                </Text>
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  stage: {
    flex: 1,
  },
  screenLayer: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    elevation: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 3,
    gap: 2,
  },
  tabGlyph: {
    fontSize: 19,
    lineHeight: 22,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: "500",
  },
  tabLabelActive: {
    fontWeight: "700",
  },
})
