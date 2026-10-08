const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vocabularyTrainerDesktop", {
  getStorageRoot: () => ipcRenderer.invoke("desktop-storage:root"),
  getStorageInfo: () => ipcRenderer.invoke("desktop-storage:info"),
  readClipboardImage: () => ipcRenderer.invoke("desktop-clipboard:read-image"),
  openImageSearch: (query, labels) =>
    ipcRenderer.invoke("desktop-image-search:open", query, labels),
  saveLessonFile: (fileName, data) =>
    ipcRenderer.invoke("desktop-storage:save-lesson", fileName, data),
  removeLessonFile: (fileName) =>
    ipcRenderer.invoke("desktop-storage:remove-lesson", fileName),
  getVoicePackageStatus: (packageId) =>
    ipcRenderer.invoke("desktop-voice-package:status", packageId),
  installVoicePackage: (packageId) =>
    ipcRenderer.invoke("desktop-voice-package:install", packageId),
  deleteVoicePackage: (packageId) =>
    ipcRenderer.invoke("desktop-voice-package:delete", packageId),
  openSystemVoiceSettings: () =>
    ipcRenderer.invoke("desktop-system:open-voice-settings"),
  onVoicePackageProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("desktop-voice-package:progress", handler);
    return () => ipcRenderer.removeListener("desktop-voice-package:progress", handler);
  },
  getTranslationPackageStatus: (packageId) =>
    ipcRenderer.invoke("desktop-translation-package:status", packageId),
  installTranslationPackage: (packageId) =>
    ipcRenderer.invoke("desktop-translation-package:install", packageId),
  deleteTranslationPackage: (packageId) =>
    ipcRenderer.invoke("desktop-translation-package:delete", packageId),
  onTranslationPackageProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("desktop-translation-package:progress", handler);
    return () =>
      ipcRenderer.removeListener("desktop-translation-package:progress", handler);
  },
  setWindowTheme: (theme) =>
    ipcRenderer.invoke("desktop-window:set-theme", theme),
  exitApplication: () => ipcRenderer.invoke("desktop-app:exit"),
});
