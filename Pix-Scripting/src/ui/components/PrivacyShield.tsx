import {
  AppEvents,
  Rectangle,
  useEffect,
  useState,
  type ScenePhase,
} from "scripting"
import {
  loadSettings,
  onSettingsChanged,
  type PrivacyShieldMaterial,
} from "../../store/settings"

/**
 * 响应式获取多任务隐私遮罩激活状态与模糊材质
 */
export function usePrivacyShieldActive(): {
  isActive: boolean
  material: PrivacyShieldMaterial
} {
  const [scenePhase, setScenePhase] = useState<ScenePhase>("active")
  const [settings, setSettings] = useState(() => loadSettings())

  useEffect(() => {
    const listener = (phase: ScenePhase) => {
      setScenePhase(phase)
    }
    AppEvents.scenePhase.addListener(listener)
    const unsub = onSettingsChanged(() => {
      setSettings(loadSettings())
    })
    return () => {
      AppEvents.scenePhase.removeListener(listener)
      unsub()
    }
  }, [])

  const isActive =
    settings.privacyShieldEnabled &&
    (scenePhase === "inactive" || scenePhase === "background")

  return {
    isActive,
    material: settings.privacyShieldMaterial ?? "ultraThinMaterial",
  }
}

/**
 * 全局通用多任务隐私保护遮罩组件
 *
 * 挂载于顶层容器（ZStack）顶部：
 * · 当 App 处于前台活跃状态时，返回 null，零布局干扰、零手势拦截、零额外性能开销；
 * · 当 App 切入多任务后台或处于非活跃过渡态时，呈现满屏毛玻璃材质遮罩，彻底杜绝多任务预览泄露。
 */
export function PrivacyShield() {
  const { isActive, material } = usePrivacyShieldActive()
  if (!isActive) return null

  return (
    <Rectangle
      fill={material}
      frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
      ignoresSafeArea={true}
    />
  )
}
