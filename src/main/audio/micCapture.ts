import * as naudiodon from "naudiodon"
import { EventEmitter } from "node:events"

import { isDev } from "../isDev"

export type MicDevice = {
  id: number
  name: string
}

export class MicCapture extends EventEmitter {
  private audioIO: any | null = null
  private readonly sampleRate = 16000
  private lastDeviceId: number | null = null
  private overflowRestartTimer: NodeJS.Timeout | null = null

  static listInputDevices(): MicDevice[] {
    const devices = naudiodon.getDevices() as Array<{
      id: number
      name: string
      maxInputChannels: number
    }>

    return devices
      .filter((d) => (d.maxInputChannels ?? 0) > 0)
      .map((d) => ({ id: d.id, name: d.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  start(deviceId: number | null = this.lastDeviceId): void {
    this.lastDeviceId = deviceId ?? null
    if (this.overflowRestartTimer) {
      clearTimeout(this.overflowRestartTimer)
      this.overflowRestartTimer = null
    }

    this.stop()

    this.audioIO = new (naudiodon as any).AudioIO({
      inOptions: {
        channelCount: 1,
        sampleFormat: naudiodon.SampleFormat16Bit,
        sampleRate: this.sampleRate,
        deviceId: deviceId ?? -1,
        closeOnError: false,
        framesPerBuffer: 1024,
      },
    })

    this.audioIO.on("data", (chunk: Buffer) => {
      const floatChunk = pcm16leToFloat32(chunk)
      this.emit("audio", floatChunk)
    })

    this.audioIO.on("error", (err: unknown) => {
      const msg =
        typeof (err as any)?.message === "string" ? String((err as any).message) : String(err)
      if (msg?.includes("input overflow")) {
        if (this.overflowRestartTimer) return
        if (isDev) {
          // eslint-disable-next-line no-console
          console.warn("[MIC] overflow — restarting stream in 500ms")
        }
        this.overflowRestartTimer = setTimeout(() => {
          this.overflowRestartTimer = null
          try {
            this.stop()
          } catch {
            // ignore
          }
          setTimeout(() => {
            try {
              this.start(this.lastDeviceId)
            } catch {
              // ignore
            }
          }, 200)
        }, 500)
        return
      }

      this.emit("error", err)
    })

    this.audioIO.start()
    this.emit("started")
  }

  stop(): void {
    if (!this.audioIO) return

    try {
      this.audioIO.quit()
    } catch {
      // ignore
    }
    this.audioIO.removeAllListeners()
    this.audioIO = null
    this.emit("stopped")
  }
}

function pcm16leToFloat32(buf: Buffer): Float32Array {
  const sampleCount = Math.floor(buf.length / 2)
  const out = new Float32Array(sampleCount)
  // Avoid per-sample Buffer reads (slow); use a typed view.
  const int16 = new Int16Array(buf.buffer, buf.byteOffset, sampleCount)
  for (let i = 0; i < sampleCount; i++) out[i] = int16[i] / 32768
  return out
}
