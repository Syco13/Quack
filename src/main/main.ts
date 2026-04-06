import { app, BrowserWindow, Menu, Tray, ipcMain } from "electron"
import { execSync } from "node:child_process"
import path from "node:path"

import { getSettings, setSettings } from "./store"
import { MicCapture } from "./audio/micCapture"
import { VadMonitor } from "./audio/vadMonitor"
import { VolumeMixer } from "./audio/volumeMixer"
import { DuckController } from "./audio/duckController"

let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
let isQuitting = false

const isDev = !app.isPackaged
const iconPath = path.join(__dirname, "../../assets/icon.png")

type EngineState = "paused" | "listening" | "ducked"

let spotifyDetected = false
let spotifySessionId: string | null = null
let engineState: EngineState = "paused"

let micWatchdogTimer: NodeJS.Timeout | null = null

const mixer = new VolumeMixer()
const duck = new DuckController(mixer)
const mic = new MicCapture()
const vad = new VadMonitor({
  sampleRate: 16000,
  windowMs: 400,
  checkIntervalMs: 80,
})

function computeRms(chunk: Float32Array): number {
  if (chunk.length === 0) return 0
  let sum = 0
  for (let i = 0; i < chunk.length; i++) {
    const v = chunk[i]
    sum += v * v
  }
  return Math.sqrt(sum / chunk.length)
}

function broadcastMicLevel(level: number): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send("mic:level", level)
}

function broadcastEngineStatus(): void {
  const win = mainWindow
  if (!win || win.isDestroyed()) return
  win.webContents.send("engine:status", {
    state: engineState,
    spotifyDetected,
  })
}

function updateEngineState(next: EngineState): void {
  if (engineState === next) return
  engineState = next
  broadcastEngineStatus()
}

function findSpotifySessionId(): string | null {
  const sessions = mixer.listSessions()
  for (const s of sessions) {
    const hay = `${s.appName} ${s.name} ${s.label}`.toLowerCase()
    if (hay.includes("spotify")) return s.id
  }
  return null
}

function isSpotifyProcessRunning(): boolean {
  try {
    const out = execSync("tasklist", { encoding: "utf8" })
    return out.includes("Spotify.exe")
  } catch {
    return false
  }
}

function applyEffectiveSettings(): void {
  // "Idiot-proof" mode:
  // - Always auto-target Spotify when detected.
  const stored = getSettings()

  // Renderer already sends 0.0..1.0; use raw value directly (clamped).
  const duckLevel01 = normalizeDuckLevel(stored.duckLevel)

  duck.updateSettings({
    enabled: stored.enabled,
    duckLevel: duckLevel01,
    releaseDelayMs: stored.releaseDelayMs,
    targetSessionId: spotifySessionId,
  })

  // Mirror to UI.
  if (!stored.enabled) updateEngineState("paused")
  else if (engineState !== "ducked") updateEngineState("listening")

  broadcastEngineStatus()
}

export function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow

  mainWindow = new BrowserWindow({
    icon: iconPath,
    width: 420,
    height: 520,
    center: true,
    frame: false,
    show: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "..", "preload", "preload.js"),
    },
  })

  mainWindow.on("close", (e) => {
    // Keep app running in tray; use tray menu "Quit" to exit.
    if (isQuitting) return
    e.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  void mainWindow.loadFile("dist/renderer/index.html")

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" })
  }

  mainWindow.webContents.on("did-finish-load", async () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    try {
      const rawHeight = await win.webContents.executeJavaScript(
        "Math.ceil(document.documentElement.scrollHeight)",
        true
      )
      const contentHeight = Number(rawHeight)
      if (!Number.isFinite(contentHeight)) return

      const minH = 260
      const maxH = 900
      const nextH = Math.max(minH, Math.min(maxH, contentHeight))
      win.setContentSize(420, nextH)
    } catch {
      // Best-effort: keep default size.
    }
  })
  return mainWindow
}

function showWindow(): void {
  const win = createWindow()
  win.show()
  win.focus()
}

function toggleWindow(): void {
  const win = createWindow()
  if (win.isVisible()) win.hide()
  else {
    win.show()
    win.focus()
  }
}

function createTray(): void {
  tray = new Tray(iconPath)
  tray.setToolTip("Quack")

  const menu = Menu.buildFromTemplate([
    {
      label: "Open",
      click: () => {
        showWindow()
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)
  tray.on("click", () => {
    toggleWindow()
  })
  tray.on("right-click", () => {
    tray?.popUpContextMenu(menu)
  })
}

async function startAudioPipeline(): Promise<void> {
  // Initial Spotify detection.
  spotifySessionId = findSpotifySessionId()
  spotifyDetected = spotifySessionId !== null

  applyEffectiveSettings()

  {
    const s = getSettings()
    if (isDev) {
      // eslint-disable-next-line no-console
      console.log(
        "[DUCK] startup:",
        "enabled=", s.enabled,
        "spotifyDetected=", spotifyDetected,
        "spotifySessionId=", spotifySessionId
      )
    }
  }

  mic.removeAllListeners()
  vad.removeAllListeners()

  let lastAudioAt = Date.now()
  if (micWatchdogTimer) {
    clearInterval(micWatchdogTimer)
    micWatchdogTimer = null
  }

  mic.on("audio", (chunk: Float32Array) => {
    lastAudioAt = Date.now()
    vad.pushAudio(chunk)
  })

  let lastLevelSentAt = 0
  mic.on("audio", (chunk: Float32Array) => {
    lastAudioAt = Date.now()
    const now = Date.now()
    if (now - lastLevelSentAt < 33) return
    lastLevelSentAt = now
    const rms = computeRms(chunk)
    broadcastMicLevel(rms)
  })

  vad.on("speech", () => {
    duck.onSpeechDetected()
  })

  vad.on("speechStart", () => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.log("[DUCK] speech started")
      // eslint-disable-next-line no-console
      console.log(`[DUCK] speech start received at: ${Date.now()}`)
    }
    duck.onSpeechStart()
    if (isDev) {
      // eslint-disable-next-line no-console
      console.log(`[DUCK] setVolume called at: ${Date.now()}`)
    }
  })

  vad.on("speechEnd", () => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.log("[DUCK] speech ended")
    }
    duck.onSpeechEnd()
  })

  duck.removeAllListeners()
  duck.on("ducked", () => {
    if (getSettings().enabled) updateEngineState("ducked")
  })
  duck.on("restored", () => {
    if (!getSettings().enabled) updateEngineState("paused")
    else updateEngineState("listening")
  })
  duck.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("Duck error:", err)
  })

  vad.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("VAD error:", err)
  })

  mic.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("Mic error:", err)
  })

  micWatchdogTimer = setInterval(() => {
    const s = getSettings()
    if (!s.enabled) return
    if (Date.now() - lastAudioAt <= 5000) return

    lastAudioAt = Date.now()
    if (isDev) {
      // eslint-disable-next-line no-console
      console.warn("[MIC] watchdog restart")
    }
    try {
      mic.start(s.micDeviceId)
    } catch {
      // ignore
    }
  }, 1000)

  await vad.start()
  const s = getSettings()
  // Default mic is represented by null; user can override via UI.
  mic.start(s.micDeviceId)
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => getSettings())

  ipcMain.handle("settings:set", (_e, patch) => {
    // Only allow the simple controls + mic selection.
    const allowedPatch: Record<string, unknown> = {}
    if (patch?.enabled !== undefined) {
      allowedPatch.enabled = patch.enabled
      if (isDev) {
        // eslint-disable-next-line no-console
        console.log("[DUCK] ducking enabled:", !!patch.enabled)
      }
    }
    if (patch?.duckLevel !== undefined) {
      const raw = Number(patch.duckLevel)
      if (isDev) {
        // eslint-disable-next-line no-console
        console.log("[DUCK] level received from renderer:", raw)
      }
      allowedPatch.duckLevel = normalizeDuckLevel(raw)
    }
    if (patch?.releaseDelayMs !== undefined) allowedPatch.releaseDelayMs = patch.releaseDelayMs
    if (patch?.micDeviceId !== undefined) allowedPatch.micDeviceId = patch.micDeviceId

    const next = setSettings(allowedPatch)
    applyEffectiveSettings()

    if (patch?.micDeviceId !== undefined) {
      mic.start(next.micDeviceId)
    }
    return next
  })

  ipcMain.handle("mic:list", () => {
    return MicCapture.listInputDevices()
  })

  ipcMain.handle("apps:list", () => {
    return mixer.listSessions().map((s) => ({ id: s.id, label: s.label }))
  })

  ipcMain.handle("engine:status:get", () => {
    return {
      state: engineState,
      spotifyDetected,
    }
  })

  ipcMain.handle("check-spotify", () => {
    return isSpotifyProcessRunning()
  })
}

function normalizeDuckLevel(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(1, raw))
}

app.setAppUserModelId("Quack")

app.on("before-quit", () => {
  duck.restoreNow()
  isQuitting = true
})

process.on("exit", () => {
  duck.restoreNow()
})

process.on("SIGINT", () => {
  duck.restoreNow()
  process.exit(0)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", () => {
    showWindow()
  })

  app.whenReady().then(async () => {
    createWindow()
    createTray()
    registerIpc()
    await startAudioPipeline()

    // Keep looking for Spotify so "open it and play something" just works.
    setInterval(() => {
      const nextId = findSpotifySessionId()
      const nextDetected = nextId !== null

      const changed = nextDetected !== spotifyDetected || nextId !== spotifySessionId
      spotifyDetected = nextDetected
      spotifySessionId = nextId

      if (changed) {
        applyEffectiveSettings()
      }
    }, 1500)
  })
}
