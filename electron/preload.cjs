/**
 * contextIsolation + sandbox 下的最小桥：只暴露两样东西——
 * 「我在桌面壳里」这个事实，和「⌘⇧D 被按了」这一个信号。
 * 页面拿不到 ipcRenderer 本身，也没有别的通道，避免把桌面能力顺手暴露出去。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolbox", {
  isDesktop: true,
  onDistractionHotkey(handler) {
    if (typeof handler !== "function") return () => {};
    const listener = () => handler();
    ipcRenderer.on("focus:distraction", listener);
    return () => ipcRenderer.removeListener("focus:distraction", listener);
  },
});
