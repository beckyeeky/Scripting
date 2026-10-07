import type { Color, CommonViewProps, Shape } from "scripting"
import { loadSettings } from "../../store/settings"

/**
 * App「自绘玻璃」（Liquid Glass）的统一入口 —— 全库唯一真源，调玻璃观感只改这里。
 * 与 ui/components/pageChrome.ts 同构：那边管顶栏，这边管材质。
 *
 * 【本模块做什么】
 * 默认材质完全跟随系统 Liquid Glass（直接返回 shape，不注入额外材质，零开销）。
 * 当开启「自定义玻璃色调」时，在 UIGlass.regular() 基础上叠加用户自选的 tint 颜色与浓度。
 * 当开启「玻璃交互」时，开启点击高亮与弹性形变。
 *
 * ⚠️ 覆盖范围仅限 App 自绘玻璃。系统自绘的部分（TabView 底栏、buttonStyle="glass"
 *   按钮、系统菜单、Sheet 栏）没有强度接口，永远跟随系统 —— 属于已确认的例外。
 *
 * 【用法】
 *   glassEffect={appGlass({ type: "rect", cornerRadius: 14 })}   // 形状形态（绝大多数）
 *   glassEffect={appGlass("capsule")}
 *   glassEffect={appGlassFlag()}                                  // 布尔形态（原 glassEffect={true}）
 */

type GlassEffectValue = NonNullable<CommonViewProps["glassEffect"]>

/** 色调默认颜色（iOS 底栏默认蓝 #007aff）与默认浓度（%），与 store/settings.ts 的默认值保持一致 */
export const DEFAULT_GLASS_TINT_COLOR = "#007aff"
export const DEFAULT_GLASS_TINT_STRENGTH = 10

// 按「档位 + 配方 + 交互标志」缓存实例
let cachedGlassKey: string | null = null
let cachedGlass: UIGlass | null = null

/** 当前设置解析出的玻璃材质；若既无色调也无交互则返回 null（表示不注入材质，走系统默认 shape）。
 *  ignoreTint=true 时退化为无色调形态。 */
function currentGlass(ignoreTint: boolean = false): UIGlass | null {
  const settings = loadSettings()
  const isTinted = settings.glassCustomTintEnabled === true && !ignoreTint
  const interactive = settings.glassInteractive === true

  if (!isTinted && !interactive) return null

  const key = `${
    isTinted ? `tint|${settings.glassTintColor}|${settings.glassTintStrength}` : "notint"
  }|${interactive ? "interactive" : "static"}`

  if (key === cachedGlassKey && cachedGlass) return cachedGlass

  let glass = UIGlass.regular()
  if (isTinted) {
    glass = glass.tint(
      tintRGBA(settings.glassTintColor, settings.glassTintStrength)
    )
  }

  glass = glass.interactive(interactive)

  cachedGlassKey = key
  cachedGlass = glass
  return glass
}

/** 形状形态：把形状原样透传，只决定材质那一半 */
export function appGlass(shape: Shape): GlassEffectValue {
  const glass = currentGlass()
  return glass ? { glass, shape } : shape
}

/** 布尔形态：原写法 `glassEffect={true}` 的等价入口 */
export function appGlassFlag(fallback: boolean = true): GlassEffectValue {
  return currentGlass() ?? fallback
}

/**
 * 形状形态（**不叠色调**）：与 appGlass 相同，强制退化为无色调形态。
 */
export function appGlassNoTint(shape: Shape): GlassEffectValue {
  const glass = currentGlass(true)
  return glass ? { glass, shape } : shape
}

// 交互控件专用缓存（恒定 interactive: true）
let cachedInteractiveGlassKey: string | null = null
let cachedInteractiveGlass: UIGlass | null = null

function currentInteractiveGlass(): UIGlass {
  const settings = loadSettings()
  const isTinted = settings.glassCustomTintEnabled === true
  const key = isTinted
    ? `tint|${settings.glassTintColor}|${settings.glassTintStrength}`
    : "notint"

  if (key === cachedInteractiveGlassKey && cachedInteractiveGlass) {
    return cachedInteractiveGlass
  }

  let glass = UIGlass.regular()
  if (isTinted) {
    glass = glass.tint(
      tintRGBA(settings.glassTintColor, settings.glassTintStrength)
    )
  }
  glass = glass.interactive(true)

  cachedInteractiveGlassKey = key
  cachedInteractiveGlass = glass
  return glass
}

/**
 * 高频交互控件专用玻璃：恒定开启 interactive(true)
 * 专供操作按钮与交互胶囊，默认自带液态弹性形变与按压高亮。
 * 不受 settings.glassInteractive 影响。
 * 若开启了「自定义玻璃色调」，自动同步注入用户自选的主题色。
 */
export function appInteractiveGlass(shape: Shape): GlassEffectValue {
  const glass = currentInteractiveGlass()
  return { glass, shape }
}

/**
 * 获取当前激活的自定义主题色。
 * 若开启了「自定义玻璃色调」且配置了颜色，则返回该主题色；
 * 否则返回回退色（默认 systemBlue，即 iOS 原生系统蓝）。
 */
export function appThemeColor(fallback: Color = "systemBlue"): Color {
  const settings = loadSettings()
  if (settings.glassCustomTintEnabled && settings.glassTintColor) {
    return settings.glassTintColor as Color
  }
  return fallback
}

/**
 * 若开启了「自定义玻璃色调」且配置了颜色，则返回该主题色；
 * 否则返回 undefined（供 NavigationStack 等 tint 属性保持系统原生出厂默认中性色）。
 */
export function appCustomTint(): Color | undefined {
  const settings = loadSettings()
  if (settings.glassCustomTintEnabled && settings.glassTintColor) {
    return settings.glassTintColor as Color
  }
  return undefined
}

/** 「颜色 + 浓度(%)」合成带 alpha 的 rgba 字符串（注意不能带空格，Color 模板字面量类型不允许） */
function tintRGBA(color: string, strength: number): Color {
  const [r, g, b] =
    parseRGB(color) ?? parseRGB(DEFAULT_GLASS_TINT_COLOR) ?? [0, 122, 255]
  const alpha = Math.round(clampPercent(strength) * 100) / 10000
  return `rgba(${r},${g},${b},${alpha})` as Color
}

function clampPercent(value: unknown): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : 0
  return Math.min(100, Math.max(0, num))
}

/** 解析 `#rrggbb` / `#rgb` / `rgb()` / `rgba()` 形式的颜色，取出 RGB 三元组 */
function parseRGB(value: string): [number, number, number] | null {
  const text = (value ?? "").trim()

  const hex6 = /^#([0-9a-fA-F]{6})$/.exec(text)
  if (hex6) {
    const v = hex6[1]
    return [
      parseInt(v.slice(0, 2), 16),
      parseInt(v.slice(2, 4), 16),
      parseInt(v.slice(4, 6), 16),
    ]
  }

  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(text)
  if (hex3) {
    const v = hex3[1]
    return [
      parseInt(v[0] + v[0], 16),
      parseInt(v[1] + v[1], 16),
      parseInt(v[2] + v[2], 16),
    ]
  }

  const css = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(text)
  if (css) {
    return [Math.round(Number(css[1])), Math.round(Number(css[2])), Math.round(Number(css[3]))]
  }

  return null
}
