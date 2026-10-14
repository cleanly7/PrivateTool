/**
 * 桌面壳递进页面的那座桥。
 *
 * 页面永远跑在 contextIsolation + sandbox 里，所以这里只暴露一个最小的、
 * 只读的接口：主进程收到全局快捷键（⌘⇧D）时喊一声，页面自己决定怎么用。
 * 跑在浏览器里时 window.toolbox 不存在，调用方走 keydown 兜底
 * （**桌面态下不能再注册 keydown**，否则一次按键会记两次分心）。
 */

export interface ToolboxBridge {
  /** 页面用来判断「这里是桌面壳」——不要用 userAgent 之类的东西猜。 */
  isDesktop: boolean;
  /** 主进程捕获到「记一次分心」时回调；返回取消订阅的函数。 */
  onDistractionHotkey: (handler: () => void) => () => void;
}

function getBridge(): ToolboxBridge | null {
  const candidate = (globalThis as { toolbox?: unknown }).toolbox;
  if (!candidate || typeof candidate !== "object") return null;
  const api = candidate as Partial<ToolboxBridge>;
  if (api.isDesktop !== true) return null;
  if (typeof api.onDistractionHotkey !== "function") return null;
  return api as ToolboxBridge;
}

/** 当前是不是跑在桌面壳里（用来决定要不要提示「⌘⇧D」这类桌面专属用法）。 */
export function isDesktopShell(): boolean {
  return getBridge() !== null;
}

/** 订阅「记一次分心」的桌面信号；返回取消订阅的函数（没有壳时是空操作）。 */
export function onDesktopDistraction(handler: () => void): () => void {
  const api = getBridge();
  if (!api) return () => {};
  try {
    return api.onDistractionHotkey(handler);
  } catch {
    // 桥坏了不能连累计时，退化成「没有快捷键」。
    return () => {};
  }
}
