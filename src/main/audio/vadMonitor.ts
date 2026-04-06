import { EventEmitter } from "node:events"
import * as vad from "@ricky0123/vad-node"

import { isDev } from "../isDev"

type VadMonitorOptions = {
  sampleRate: number
  windowMs: number
  checkIntervalMs: number
}

/**
 * Near-real-time speech detection using `@ricky0123/vad-node` (NonRealTimeVAD)
 * by periodically running VAD on a rolling audio window.
 */
export class VadMonitor extends EventEmitter {
  private readonly sampleRate: number
  private readonly windowSamples: number
  private readonly checkIntervalMs: number
  private readonly ring: FloatRingBuffer

  private timer: NodeJS.Timeout | null = null
  private vadInstance: vad.NonRealTimeVAD | null = null

  private windowBuf: Float32Array
  private checking = false

  private speaking = false
  private lastSpeechAt = 0
  private readonly endDelayMs: number

  constructor(opts: VadMonitorOptions) {
    super()
    this.sampleRate = opts.sampleRate
    this.windowSamples = Math.max(1, Math.floor((opts.windowMs / 1000) * opts.sampleRate))
    this.checkIntervalMs = opts.checkIntervalMs
    this.endDelayMs = Math.max(0, Math.floor(this.checkIntervalMs * 2))

    // Keep a bit extra so window reads are always possible
    this.ring = new FloatRingBuffer(this.windowSamples * 2)
    this.windowBuf = new Float32Array(this.windowSamples)
  }

  async start(): Promise<void> {
    await this.stop()

    const vadOptions = {
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.4,
      redemptionFrames: 3,
      preSpeechPadFrames: 1,
      minSpeechFrames: 2,
    }

    if (isDev) {
      // eslint-disable-next-line no-console
      console.log("[VAD] options:", vadOptions)
    }
    this.vadInstance = await vad.NonRealTimeVAD.new(vadOptions as any)

    // Schedule VAD checks serially to avoid overlapping work when inference is slow.
    this.timer = setTimeout(() => {
      void this.tick()
    }, this.checkIntervalMs)

    this.emit("started")
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.vadInstance = null
    this.ring.clear()
    this.speaking = false
    this.lastSpeechAt = 0
    this.checking = false
    this.emit("stopped")
  }

  pushAudio(chunk: Float32Array): void {
    this.ring.push(chunk)
  }

  private async tick(): Promise<void> {
    this.timer = null
    await this.checkOnce()
    if (!this.vadInstance) return
    this.timer = setTimeout(() => {
      void this.tick()
    }, this.checkIntervalMs)
  }

  private async checkOnce(): Promise<void> {
    if (this.checking) return
    this.checking = true
    try {
      const instance = this.vadInstance
      if (!instance) return
      if (this.ring.size < this.windowSamples) return

      // Reuse a preallocated window buffer to reduce GC churn.
      this.ring.readLastInto(this.windowBuf, this.windowSamples)
      const window = this.windowBuf

      const now = Date.now()
      let hasSpeech = false
      for await (const _seg of instance.run(window, this.sampleRate)) {
        hasSpeech = true
        break
      }

      if (hasSpeech) {
        this.lastSpeechAt = now
        if (!this.speaking) {
          this.speaking = true
          if (isDev) {
            // eslint-disable-next-line no-console
            console.log(`[VAD] speech start fired at: ${Date.now()}`)
          }
          this.emit("speechStart")
        }
        this.emit("speech")
      } else if (this.speaking && now - this.lastSpeechAt >= this.endDelayMs) {
        this.speaking = false
        this.emit("speechEnd")
      }
    } catch (err) {
      this.emit("error", err)
    } finally {
      this.checking = false
    }
  }
}

class FloatRingBuffer {
  private buf: Float32Array
  private writeIdx = 0
  private _size = 0

  constructor(capacity: number) {
    this.buf = new Float32Array(Math.max(1, capacity))
  }

  get size(): number {
    return this._size
  }

  clear(): void {
    this.writeIdx = 0
    this._size = 0
  }

  push(chunk: Float32Array): void {
    if (chunk.length === 0) return
    let offset = 0
    let remaining = chunk.length
    while (remaining > 0) {
      const toEnd = this.buf.length - this.writeIdx
      const copyLen = Math.min(remaining, toEnd)
      this.buf.set(chunk.subarray(offset, offset + copyLen), this.writeIdx)
      this.writeIdx = (this.writeIdx + copyLen) % this.buf.length
      offset += copyLen
      remaining -= copyLen
    }
    this._size = Math.min(this.buf.length, this._size + chunk.length)
  }

  readLastInto(out: Float32Array, count: number): number {
    const n = Math.min(count, this._size)
    if (out.length < n) throw new Error("readLastInto: output buffer too small")

    let start = this.writeIdx - n
    if (start < 0) start += this.buf.length

    if (start + n <= this.buf.length) {
      out.set(this.buf.subarray(start, start + n), 0)
    } else {
      const firstLen = this.buf.length - start
      out.set(this.buf.subarray(start), 0)
      out.set(this.buf.subarray(0, n - firstLen), firstLen)
    }

    return n
  }
}
