import { EventEmitter } from "node:events"
import { VolumeMixer } from "./volumeMixer"

import { isDev } from "../isDev"

export type DuckControllerSettings = {
  enabled: boolean
  targetSessionId: string | null
  duckLevel: number
  releaseDelayMs: number
}

export class DuckController extends EventEmitter {
  private readonly mixer: VolumeMixer

  private enabled = true
  private targetSessionId: string | null = null
  private duckLevel = 0.2
  private releaseDelayMs = 1500

  private duckedSessionId: string | null = null
  private originalVolume: number | null = null
  private restoreTimer: NodeJS.Timeout | undefined

  constructor(mixer: VolumeMixer) {
    super()
    this.mixer = mixer
  }

  updateSettings(next: DuckControllerSettings): void {
    const prevSessionId = this.targetSessionId

    this.enabled = next.enabled
    this.targetSessionId = next.targetSessionId
    this.duckLevel = clamp01(next.duckLevel)
    this.releaseDelayMs = Math.max(0, next.releaseDelayMs)

    // If disabling or changing target while ducked, restore immediately.
    if (!this.enabled) {
      this.restoreNow()
    } else if (prevSessionId !== this.targetSessionId && this.duckedSessionId !== null) {
      this.restoreNow()
    }
  }

  onSpeechStart(): void {
    this.duckNow("speechStart")
  }

  onSpeechDetected(): void {
    // Keepalive while speaking; also re-applies duck if needed.
    this.duckNow("speech")
  }

  onSpeechEnd(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer)
      this.restoreTimer = undefined
    }
    if (!this.enabled) return
    if (this.duckedSessionId === null) return

    this.restoreTimer = setTimeout(() => {
      this.restoreNow()
    }, this.releaseDelayMs)
  }

  private duckNow(reason: "speechStart" | "speech"): void {
    // Cancel any pending restore immediately when new speech arrives.
    const hadPendingRestore = this.restoreTimer !== undefined
    clearTimeout(this.restoreTimer)
    this.restoreTimer = undefined
    if (hadPendingRestore) {
      if (isDev) {
        // eslint-disable-next-line no-console
        console.log("[DUCK] cancelled pending restore — re-ducking immediately")
      }
    }

    if (!this.enabled) return
    if (!this.targetSessionId) return

    try {
      const sessionId = this.targetSessionId

      if (this.duckedSessionId === null) {
        try {
          this.originalVolume = this.mixer.getSessionVolume(sessionId)
        } catch {
          this.originalVolume = null
        }
        this.duckedSessionId = sessionId
      }

      const rawSetting = this.duckLevel
      const duckTarget = clamp01(rawSetting)
      const oneMinus = clamp01(1 - rawSetting)

      if (isDev) {
        // eslint-disable-next-line no-console
        console.log(
          "[DUCK] duck target:",
          "reason=", reason,
          "rawSetting=", rawSetting,
          "duckTarget=", duckTarget,
          "(1-raw)=", oneMinus,
          "originalVolume=", this.originalVolume
        )
      }

      // Volume API expects 0.0..1.0 scalar; duckTarget is absolute.
      this.mixer.setSessionVolume(sessionId, duckTarget)
      this.emit("ducked", { sessionId, ducked: duckTarget, base: this.originalVolume })
    } catch (err) {
      this.emit("error", err)
    }
  }

  restoreNow(): void {
    clearTimeout(this.restoreTimer)
    this.restoreTimer = undefined

    if (this.duckedSessionId === null) {
      this.originalVolume = null
      return
    }

    try {
      const restoreTarget = 1
      if (isDev) {
        // eslint-disable-next-line no-console
        console.log(
          "[DUCK] restoring volume:",
          "sessionId=", this.duckedSessionId,
          "to=", restoreTarget,
          "(originalVolume was)", this.originalVolume
        )
      }
      this.mixer.setSessionVolume(this.duckedSessionId, restoreTarget)
      this.emit("restored", {
        sessionId: this.duckedSessionId,
        volume: restoreTarget,
      })
    } catch (err) {
      this.emit("error", err)
    } finally {
      this.duckedSessionId = null
      this.originalVolume = null
    }
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}
