# Quack 🦆
> Automatically lowers your Spotify volume when you talk no OBS required.

## What it does
- Listens to your microphone.
- When you speak, lowers Spotify’s app-session volume.
- Restores Spotify volume after a configurable delay.

## Requirements
- Windows 10/11
- Spotify (free or premium)
- A microphone

## Installation
- Download the latest `.exe` from the GitHub Releases page: [Releases](../../releases)

## Building from source
```powershell
npm install
npm run dev
```

```powershell
npm run build
```

## How it works (brief technical overview)
Silero VAD detects speech via microphone → Windows Core Audio API lowers Spotify's audio session volume → restores after configurable delay.

## Contributing
Issues and PRs welcome. Keep changes Windows-only and tray-first.

## License
MIT
