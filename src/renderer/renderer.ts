export {}

declare global {
  interface Window {
    duckit: {
      getSettings: () => Promise<{
        enabled: boolean
        micDeviceId: number | null
        targetSessionId: string | null
        duckLevel: number
        releaseDelayMs: number
      }>
      setSettings: (patch: Partial<{
        enabled: boolean
        micDeviceId: number | null
        targetSessionId: string | null
        duckLevel: number
        releaseDelayMs: number
      }>) => Promise<{
        enabled: boolean
        micDeviceId: number | null
        targetSessionId: string | null
        duckLevel: number
        releaseDelayMs: number
      }>
      listMics: () => Promise<Array<{ id: number; name: string }>>
      checkSpotify: () => Promise<boolean>
    }
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element: ${id}`)
  return el as T
}

const enabledEl = byId<HTMLInputElement>("enabledToggle")
const micEl = byId<HTMLSelectElement>("micSelect")
const duckEl = byId<HTMLInputElement>("duckSlider")
const releaseEl = byId<HTMLInputElement>("releaseSlider")
const duckValueEl = byId<HTMLDivElement>("duckValue")
const releaseValueEl = byId<HTMLDivElement>("releaseValue")
const hintEl = byId<HTMLDivElement>("hint")

const duckMinusEl = byId<HTMLButtonElement>("duckMinus")
const duckPlusEl = byId<HTMLButtonElement>("duckPlus")
const releaseMinusEl = byId<HTMLButtonElement>("releaseMinus")
const releasePlusEl = byId<HTMLButtonElement>("releasePlus")

const spotifyDotEl = byId<HTMLSpanElement>("spotifyDot")
const spotifyTextEl = byId<HTMLSpanElement>("spotifyText")

let current = {
  enabled: true,
  micDeviceId: null as number | null,
  targetSessionId: null as string | null,
  duckLevel: 0.2,
  releaseDelayMs: 1500,
}

function setHint(msg: string): void {
  hintEl.textContent = msg
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function bumpRange(el: HTMLInputElement, deltaSteps: number): void {
  const min = Number(el.min)
  const max = Number(el.max)
  const step = Number(el.step) || 1
  const next = clamp(Number(el.value) + deltaSteps * step, min, max)
  el.value = String(next)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

function fillSelect(
  select: HTMLSelectElement,
  items: Array<{ value: string; label: string }>,
  selected: string | null
): void {
  select.innerHTML = ""
  for (const it of items) {
    const opt = document.createElement("option")
    opt.value = it.value
    opt.textContent = it.label
    if (selected !== null && it.value === selected) opt.selected = true
    select.appendChild(opt)
  }
}

async function loadMics(): Promise<void> {
  const mics = await window.duckit.listMics()
  const items = [{ value: "", label: "Standard (empfohlen)" }].concat(
    mics.map((m: { id: number; name: string }) => ({
      value: String(m.id),
      label: m.name,
    }))
  )
  const selected = current.micDeviceId === null ? "" : String(current.micDeviceId)
  fillSelect(micEl, items, selected)
}

function setMicSelection(deviceId: number | null): void {
  const v = deviceId === null ? "" : String(deviceId)
  if (micEl.value !== v) micEl.value = v
}

function renderDuckValue(): void {
  duckValueEl.textContent = `${Math.round(current.duckLevel * 100)}%`
}

function renderReleaseValue(): void {
  releaseValueEl.textContent = `${Math.round(current.releaseDelayMs)} ms`
}

function renderSpotify(detected: boolean): void {
  spotifyDotEl.classList.remove("good", "bad")
  if (detected) {
    spotifyDotEl.classList.add("good")
    spotifyTextEl.textContent = "Spotify läuft ✓"
  } else {
    spotifyDotEl.classList.add("bad")
    spotifyTextEl.textContent = "Spotify nicht gefunden"
  }
}

function applyToForm(): void {
  enabledEl.checked = current.enabled
  duckEl.value = String(Math.round(current.duckLevel * 100))
  releaseEl.value = String(current.releaseDelayMs)
  renderDuckValue()
  renderReleaseValue()
}

async function boot(): Promise<void> {
  try {
    setHint("Loading…")
    current = await window.duckit.getSettings()
    applyToForm()

    setHint("")
  } catch (e) {
    setHint(`Error: ${String(e)}`)
  }
}

enabledEl.addEventListener("change", async () => {
  current = await window.duckit.setSettings({ enabled: enabledEl.checked })
})

// Note: mic dropdown is populated via MediaDevices in index.html.

duckEl.addEventListener("input", async () => {
  const v = Number(duckEl.value) / 100
  current = { ...current, duckLevel: v }
  renderDuckValue()
  current = await window.duckit.setSettings({ duckLevel: v })
})

releaseEl.addEventListener("input", async () => {
  const v = Number(releaseEl.value)
  current = { ...current, releaseDelayMs: v }
  renderReleaseValue()
  current = await window.duckit.setSettings({ releaseDelayMs: v })
})

// Note: +/- buttons are wired via exact DOM snippets in index.html.

async function pollSpotify(): Promise<void> {
  try {
    const detected = await window.duckit.checkSpotify()
    renderSpotify(detected)
  } catch {
    renderSpotify(false)
  }
}

void pollSpotify()
setInterval(() => {
  void pollSpotify()
}, 2000)

void boot()
