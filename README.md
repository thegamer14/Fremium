# Fremium

Fremium is a Spicetify CustomApp for music discovery, listening insights, and playlist tools. Its complete React window stays open while you browse Spotify and can be moved and resized anywhere.

## Features

- Dashboard with current-track, queue, streak, and Last.fm status
- Last.fm profile, recent tracks, top tags, artists, and albums
- Musical streaks and album/artist completion tracking
- Taste DNA, discovery percentage, and listening personality
- Deep Cut Finder and multi-tag Genre Fusion
- Music Roulette and timestamp-based Time Machine
- AI playlist prompts, mood playlists, and similarity discovery
- Queue Intelligence UI and local learning data
- Persistent full-size window with all tabs
- Draggable header, resizable lower-right corner, and saved layout

## Install on Windows

### Quick Install

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/thegamer14/Fremium/main/install.ps1 | iex
```

### Manual Install

1. Clone the repository:

```powershell
git clone https://github.com/thegamer14/Fremium.git
```

2. Copy the project into your Spicetify CustomApps folder:

```powershell
$source = "$env:USERPROFILE\Downloads\Fremium"
$target = "$env:APPDATA\spicetify\CustomApps\spicify-plugin"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path "$source\*" -Destination $target -Recurse -Force
```

3. Enable and apply Fremium:

```powershell
spicetify config custom_apps spicify-plugin
spicetify apply
```

4. Fully restart Spotify.

The Windows installer also creates `C:\Free Saves` for Queue Intelligence snapshots.

## Install on Linux or macOS

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/thegamer14/Fremium/main/install.sh)
```

The installer requires `spicetify`, `curl`, and `tar` to be available.

## Using the Full Window

Select the `◈` launcher in Spotify to open Fremium.

- Drag the green title bar to move the window.
- Drag the lower-right corner to resize it.
- Use the title-bar controls to minimize or close the window.
- Position, dimensions, active tab, and open state are remembered.

The launcher remains available on playlists, Home, search, and library pages.

## Last.fm Setup

Fremium does not include API credentials. Create a Last.fm API account at [Last.fm API accounts](https://www.last.fm/api/account/create), then open **Last.fm** inside Fremium and enter:

- Last.fm username
- API key
- API secret

Credentials are stored locally with `Spicetify.LocalStorage` and are not written to this repository.

## Queue Intelligence Saves

The base Fremium page includes a live Queue Intelligence panel. It keeps the current session in memory and does not continuously write QI data to LocalStorage. Use **Choose C:\\Free Saves** once to grant Spotify folder access, then use:

- **Save Snapshot** — writes a timestamped JSON file to `C:\Free Saves`
- **Download JSON** — downloads a copy through Spotify/browser downloads
- **Import JSON** — imports one or more saved JSON files; enable replace mode to restore one snapshot instead of merging
- **Snapshot Queue** — records the current queue as a live event

Live QI resets when Spotify restarts unless you save or import a snapshot.

## Project Files

- `index.js` — CustomApp, full floating window, tabs, and integrations
- `fremium-overlay.js` — persistent launcher extension
- `style.css` — Spotify-compatible window and launcher styling
- `manifest.json` — Spicetify app metadata
- `fremium-qi-extension.js` — live in-memory Queue Intelligence runtime and snapshot file controls
- `queue-training.js` — legacy local Queue Intelligence data model
- `queue-training-panel.js` — legacy Queue Intelligence data panel

Queue Intelligence is live in memory and is not continuously written to LocalStorage. Use the base-page Queue Intelligence panel to save timestamped JSON snapshots to `C:\Free Saves`, download a copy, or import one or more JSON files. Spotify must grant folder access the first time you choose the folder.

## Development

After editing files in `%APPDATA%\spicetify\CustomApps\spicify-plugin`, run:

```powershell
spicetify apply
```

Restart Spotify or press `Ctrl+Shift+R` to reload the interface.

## License

MIT
