# Fremium

Fremium is a Spicetify CustomApp for music discovery, listening insights, and playlist tools. Its complete React window stays open while you browse Spotify and can be moved and resized anywhere.

## Demo website

Try the self-contained GitHub Pages demo: [fremium demo](https://thegamer14.github.io/Fremium/)

## Fremium Account Sync

Fremium can sync private listening events and Queue Intelligence summaries to a Supabase-backed account. The website then shows the user’s current song, recent activity, top tracks, lifetime listening totals, and QI scores.

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL Editor.
2. In Supabase **Authentication → URL Configuration**, set **Site URL** and add the same value under **Redirect URLs**: `https://thegamer14.github.io/Fremium/`.
3. The public project URL and publishable key are bundled in [`fremium-account-config.js`](fremium-account-config.js) and [`docs/account-config.js`](docs/account-config.js); normal users do not need to configure them.
4. Open the main **Fremium** page and create an account with a username, email, and password.
5. Use **Sync now** or leave automatic sync enabled.
6. Open the website and sign in with the same email and password.

The publishable key is public by design; row-level security restricts profile, event, and QI snapshot access to the authenticated owner. Never put the Supabase secret key in the app, site, or repository. Fremium does not ask for or store a Spotify password. Access and refresh tokens remain in the local app/browser session, and the account is not a substitute for Spotify OAuth.

Synced tables are private and include `fremium_profiles`, `fremium_sync_state`, `fremium_listening_events`, and `fremium_qi_snapshots`. The app sends aggregate QI summaries and current-track explanations rather than the full learned profile.

## Features

- Dashboard with current-track, queue, streak, and Last.fm status
- Last.fm profile, recent tracks, top tags, artists, and albums
- Musical streaks and album/artist completion tracking
- Taste DNA, discovery percentage, and listening personality
- Deep Cut Finder and multi-tag Genre Fusion
- Music Roulette and timestamp-based Time Machine
- AI playlist prompts, mood playlists, and similarity discovery
- Natural-language AI references to artists, tracks, playlist names, and Spotify playlist links
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

## AI Prompt References

The AI tab understands natural-language references such as:

- `Give me songs like I'm butterbean`
- `Make a 10 song Novo Amor mix`
- `Make a 10 song Novo Amor and Josh Pyke mix`
- `Make me an NF mix with some songs from my folk mix playlist`
- `Play songs by The B-52's`
- `Play the Roadtrip playlist`
- A pasted Spotify playlist link

Playlist names are searched in your Spotify library first, then public Spotify playlist results. Playlist tracks are queued in playlist order and still use Fremium's duplicate and AI-history filtering.

## Queue Intelligence Saves

The base Fremium page includes a live Queue Intelligence panel. It keeps the current session in memory and does not write QI data to LocalStorage. Learning includes:

- Consecutive-skip penalties, skip decay, weighted replay and completion boosts
- Early/late queue-position learning, abandonment tracking, and skip-timing buckets
- Separate current-session, recent, and lifetime preference scores
- Recent behavior is weighted more heavily while lifetime preferences remain available
- Queue ranking and similar-track suggestions use the combined learning signals
- Playlist, artist, genre, time-of-day/weekday context, and track-transition relationships
- Confidence-aware “Why?” explanations, QI Memory, and debug breakdowns

Use **Choose C:\\Free Saves** once to grant Spotify folder access. QI creates this structure:

```text
C:\Free Saves\Fremium\QI\
  QI_Profile.json
  QI_History.json
  QI_Stats.json
  Backups\
    QI_2026-09-24_2204.json
```

When a folder is connected, QI continuously updates the three root JSON files after learning events. When no folder is connected, real-time file saving is disabled and QI remains memory-only. Manual backups rotate to the ten newest files.

Manual controls remain available:

- **Save Snapshot** — writes a validated full backup under `Fremium\\QI\\Backups`
- **Restore Latest Backup** — restores the newest valid backup
- **Download JSON** — downloads a copy through Spotify/browser downloads
- **Import JSON** — imports one or more saved JSON files; replace mode restores a snapshot, while normal mode merges data
- **Merge Profile** — merges learned profile data without replacing the live session
- **Why this track?** — shows the signals behind a QI score
- **QI Memory** — summarizes learned listening behavior
- **Snapshot Queue** — records the current queue as a live event

Live QI resets when Spotify restarts unless a profile, history, or backup file is imported.

## Project Files

- `index.js` — CustomApp, full floating window, tabs, and integrations
- `fremium-overlay.js` — persistent launcher extension
- `style.css` — Spotify-compatible window and launcher styling
- `manifest.json` — Spicetify app metadata
- `fremium-qi-extension.js` — live Queue Intelligence runtime, weighted learning scores, and conditional live-file autosave
- `fremium-account-config.js` — public Supabase project configuration for the app
- `fremium-account.js` — Supabase authentication and private account sync bridge
- `supabase/schema.sql` — private account, listening-event, and QI snapshot tables with row-level security
- `docs/account-config.js` — public Supabase project configuration for the website
- `docs/account.js` — website account sign-in and personalized dashboard
- `queue-training.js` — legacy local Queue Intelligence data model
- `queue-training-panel.js` — legacy Queue Intelligence data panel

Queue Intelligence separates live events/session state from learned profile data. With a selected Free Saves folder, the extension continuously updates `QI_Profile.json`, `QI_History.json`, and `QI_Stats.json`; without one, it performs no real-time file writes. Manual backups, restore, merge/import, validation, and rotation are available from the base-page panel.

## Development

After editing files in `%APPDATA%\spicetify\CustomApps\spicify-plugin`, run:

```powershell
spicetify apply
```

Restart Spotify or press `Ctrl+Shift+R` to reload the interface.

## License

MIT
