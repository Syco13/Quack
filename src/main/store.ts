import Store from "electron-store"

type StoreLike<T extends Record<string, any>> = {
  get<Key extends keyof T>(key: Key): T[Key]
  set<Key extends keyof T>(key: Key, value: T[Key]): void
}

export type DuckItSettings = {
  enabled: boolean
  micDeviceId: number | null
  targetSessionId: string | null
  duckLevel: number // 0..1 (e.g. 0.2 = 20%)
  releaseDelayMs: number
}

export const DEFAULT_SETTINGS: DuckItSettings = {
  enabled: true,
  micDeviceId: null,
  targetSessionId: null,
  duckLevel: 0.2,
  releaseDelayMs: 1500,
}

export const settingsStore = new Store<DuckItSettings>({
  name: "settings",
  defaults: DEFAULT_SETTINGS,
  schema: {
    enabled: { type: "boolean" },
    micDeviceId: { anyOf: [{ type: "number" }, { type: "null" }] },
    targetSessionId: { anyOf: [{ type: "string" }, { type: "null" }] },
    duckLevel: { type: "number", minimum: 0, maximum: 1 },
    releaseDelayMs: { type: "number", minimum: 0 },
  },
}) as unknown as StoreLike<DuckItSettings>

export function getSettings(): DuckItSettings {
  return {
    enabled: settingsStore.get("enabled"),
    micDeviceId: settingsStore.get("micDeviceId"),
    targetSessionId: settingsStore.get("targetSessionId"),
    duckLevel: settingsStore.get("duckLevel"),
    releaseDelayMs: settingsStore.get("releaseDelayMs"),
  }
}

export function setSettings(patch: Partial<DuckItSettings>): DuckItSettings {
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof DuckItSettings, DuckItSettings[keyof DuckItSettings]]
  >) {
    settingsStore.set(key, value as any)
  }
  return getSettings()
}
