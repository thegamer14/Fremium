$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = "thegamer14/Fremium"
$appId = "spicify-plugin"
$archiveUrl = "https://github.com/$repo/archive/refs/heads/main.zip"
$spicetifyPath = (Get-Command spicetify -ErrorAction SilentlyContinue).Source

if (-not $spicetifyPath) {
  throw "Spicetify is not installed or is not available on PATH. Install Spicetify first, then run this command again."
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("fremium-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
  $archivePath = Join-Path $tempRoot "fremium.zip"
  Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
  Expand-Archive -LiteralPath $archivePath -DestinationPath $tempRoot -Force

  $sourceDir = Get-ChildItem -LiteralPath $tempRoot -Directory |
    Where-Object { $_.Name -like "Fremium-*" } |
    Select-Object -First 1

  if (-not $sourceDir) {
    throw "The Fremium download did not contain the expected project folder."
  }

  $targetDir = Join-Path $env:APPDATA "spicetify\CustomApps\$appId"
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
  Copy-Item -Path (Join-Path $sourceDir.FullName "*") -Destination $targetDir -Recurse -Force

  & $spicetifyPath config custom_apps $appId
  if ($LASTEXITCODE -ne 0) { throw "Spicetify could not enable the Fremium custom app." }

  & $spicetifyPath apply
  if ($LASTEXITCODE -ne 0) { throw "Spicetify could not apply the Fremium installation." }

  Write-Host ""
  Write-Host "Fremium installed successfully." -ForegroundColor Green
  Write-Host "Restart Spotify to finish."
}
finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
