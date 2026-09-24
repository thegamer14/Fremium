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

## Project Files

- `index.js` — CustomApp, full floating window, tabs, and integrations
- `fremium-overlay.js` — persistent launcher extension
- `style.css` — Spotify-compatible window and launcher styling
- `manifest.json` — Spicetify app metadata
- `queue-training.js` — local Queue Intelligence data model
- `queue-training-panel.js` — Queue Intelligence data panel

Queue Intelligence subfiles are currently disabled in `manifest.json` while Spotify stability is evaluated.

## Development

After editing files in `%APPDATA%\spicetify\CustomApps\spicify-plugin`, run:

```powershell
spicetify apply
```

Restart Spotify or press `Ctrl+Shift+R` to reload the interface.

## License

MIT
