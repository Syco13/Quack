import { contextBridge, ipcRenderer } from "electron"

export type DuckItSettings = {
  enabled: boolean
  micDeviceId: number | null
  targetSessionId: string | null
  duckLevel: number
  releaseDelayMs: number
}

export type MicDevice = { id: number; name: string }
export type TargetApp = { id: string; label: string }

export type Unsubscribe = () => void

export type EngineStatus = {
  state: "paused" | "listening" | "ducked"
  spotifyDetected: boolean
}

const api = {
  getSettings: (): Promise<DuckItSettings> => ipcRenderer.invoke("settings:get"),
  setSettings: (patch: Partial<DuckItSettings>): Promise<DuckItSettings> =>
    ipcRenderer.invoke("settings:set", patch),
  listMics: (): Promise<MicDevice[]> => ipcRenderer.invoke("mic:list"),
  listApps: (): Promise<TargetApp[]> => ipcRenderer.invoke("apps:list"),
  checkSpotify: (): Promise<boolean> => ipcRenderer.invoke("check-spotify"),
  onMicLevel: (cb: (level: number) => void): Unsubscribe => {
    const listener = (_e: Electron.IpcRendererEvent, level: number) => cb(level)
    ipcRenderer.on("mic:level", listener)
    return () => ipcRenderer.off("mic:level", listener)
  },
  getEngineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke("engine:status:get"),
  onEngineStatus: (cb: (status: EngineStatus) => void): Unsubscribe => {
    const listener = (_e: Electron.IpcRendererEvent, status: EngineStatus) => cb(status)
    ipcRenderer.on("engine:status", listener)
    return () => ipcRenderer.off("engine:status", listener)
  },
}

contextBridge.exposeInMainWorld("duckit", api)

export type DuckItApi = typeof api
