import SoundMixer, {
  AudioSession,
  AudioSessionState,
  Device,
  DeviceType,
} from "native-sound-mixer"

export type AudioSessionInfo = {
  id: string
  appName: string
  name: string
  label: string
}

export class VolumeMixer {
  listSessions(): AudioSessionInfo[] {
    const device = this.getDefaultRenderDevice()
    if (!device) return []

    const out: AudioSessionInfo[] = []
    for (const s of device.sessions ?? []) {
      if (!s) continue
      if (s.state === AudioSessionState.EXPIRED) continue

      const appName = String(s.appName ?? "")
      const name = String(s.name ?? "")
      const id = makeSessionId(appName, name)

      const appLabel = appName || "(unknown app)"
      const nameLabel = name || "(unknown session)"
      const label = name && name !== appName ? `${appLabel} — ${nameLabel}` : appLabel
      out.push({ id, appName, name, label })
    }

    // de-dupe by id
    const uniq = new Map<string, AudioSessionInfo>()
    for (const s of out) uniq.set(s.id, s)

    return [...uniq.values()].sort((a, b) => a.label.localeCompare(b.label))
  }

  getSessionVolume(sessionId: string): number {
    const session = this.getSessionById(sessionId)
    if (!session) throw new Error("Audio session not found")
    return session.volume
  }

  setSessionVolume(sessionId: string, volumeScalar: number): void {
    try {
      // Refresh device/sessions each call; sessions can change when apps change tracks.
      const device = this.getDefaultRenderDevice()
      const session =
        this.getSessionByIdOnDevice(device, sessionId) ?? this.findSpotifySessionOnDevice(device)
      if (!session) throw new Error("Audio session not found")
      session.volume = clamp01(volumeScalar)
    } catch (err) {
      if (err instanceof Error && err.message === "Audio session not found") return
      throw err
    }
  }

  private getDefaultRenderDevice(): Device | undefined {
    return SoundMixer.getDefaultDevice(DeviceType.RENDER)
  }

  private getSessionById(sessionId: string): AudioSession | undefined {
    const device = this.getDefaultRenderDevice()
    return this.getSessionByIdOnDevice(device, sessionId)
  }

  private getSessionByIdOnDevice(
    device: Device | undefined,
    sessionId: string
  ): AudioSession | undefined {
    if (!device) return undefined
    const sessions = device.sessions ?? []
    for (const s of sessions) {
      if (!s) continue
      if (s.state === AudioSessionState.EXPIRED) continue
      const id = makeSessionId(String((s as any).appName ?? ""), String((s as any).name ?? ""))
      if (id === sessionId) return s
    }
    return undefined
  }

  private findSpotifySessionOnDevice(device: Device | undefined): AudioSession | undefined {
    if (!device) return undefined
    const sessions = device.sessions ?? []
    for (const s of sessions) {
      if (!s) continue
      if (s.state === AudioSessionState.EXPIRED) continue

      const hay = [
        String((s as any).appName ?? ""),
        String((s as any).path ?? ""),
        String((s as any).exePath ?? ""),
        String((s as any).processPath ?? ""),
      ]
        .join(" ")
        .toLowerCase()

      if (hay.includes("spotify.exe")) return s
    }
    return undefined
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function makeSessionId(appName: string, name: string): string {
  return `${appName}::${name}`
}
