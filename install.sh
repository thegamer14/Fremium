#!/usr/bin/env bash
set -euo pipefail

repo="thegamer14/Fremium"
app_id="spicify-plugin"
archive_url="https://github.com/${repo}/archive/refs/heads/main.tar.gz"

if ! command -v spicetify >/dev/null 2>&1; then
  printf '%s\n' "Spicetify is not installed or is not available on PATH. Install Spicetify first, then run this command again." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  printf '%s\n' "curl and tar are required to install Fremium." >&2
  exit 1
fi

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/fremium.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

curl -fsSL "$archive_url" -o "$tmp_dir/fremium.tar.gz"
tar -xzf "$tmp_dir/fremium.tar.gz" -C "$tmp_dir"

source_dir="$(find "$tmp_dir" -maxdepth 1 -type d -name 'Fremium-*' -print -quit)"
if [ -z "$source_dir" ]; then
  printf '%s\n' "The Fremium download did not contain the expected project folder." >&2
  exit 1
fi

config_root="${XDG_CONFIG_HOME:-$HOME/.config}/spicetify"
target_dir="$config_root/CustomApps/$app_id"
mkdir -p "$target_dir"
cp -R "$source_dir"/. "$target_dir"/

spicetify config custom_apps "$app_id"
spicetify apply

printf '\n%s\n' "Fremium installed successfully."
printf '%s\n' "Restart Spotify to finish."
