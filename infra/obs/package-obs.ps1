param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9.-]{0,60}$')][string]$Release,
  [string]$OutputDirectory = "dist/obs"
)
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
Set-Location -LiteralPath $root
$dirty = & git status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw "Commit reviewed source before packaging; working tree must be clean" }
$output = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
$bundle = Join-Path $output $Release
if (Test-Path -LiteralPath $bundle) { throw "Release exists; choose a new release" }
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
function Invoke-Docker([string[]]$Arguments) {
  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & docker @Arguments; $dockerCode = $LASTEXITCODE }
  finally { $ErrorActionPreference = $oldPreference }
  if ($dockerCode -ne 0) { throw "Docker command failed" }
}
$images = @()
$manifest = @()
foreach ($line in Get-Content -LiteralPath "infra/obs/obs.env.example") {
  if ($line -match '^(PROMETHEUS_IMAGE|GRAFANA_IMAGE)=(.+)$') {
    $field = $Matches[1]; $pinned = $Matches[2]; $tag = $pinned.Split('@')[0]
    Invoke-Docker @("pull", "--platform", "linux/amd64", $pinned)
    $inspection = & docker image inspect $pinned --format '{{.Id}} {{.Os}}/{{.Architecture}}'
    if ($LASTEXITCODE -ne 0 -or $inspection -notmatch 'linux/amd64$') { throw "Invalid image platform" }
    Invoke-Docker @("tag", $pinned, $tag)
    $images += $tag
    $manifest += "$field $tag $inspection $pinned"
  }
}
if ($images.Count -ne 2) { throw "Expected two pinned obs images" }
$files = @(
  "infra/compose/docker-compose.obs.yml", "infra/prometheus/prometheus.yml", "infra/prometheus/targets/apps.json",
  "infra/grafana/provisioning/datasources/prometheus.yml", "infra/grafana/provisioning/dashboards/red.yml",
  "infra/grafana/dashboards/red.json", "infra/obs/obs.sh", "infra/obs/obs.env.example", "docs/ops/observability.md"
)
foreach ($file in $files) {
  $target = Join-Path $bundle $file
  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination $target
}
$utf8 = [Text.UTF8Encoding]::new($false)
$commit = & git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw "Cannot identify source commit" }
[IO.File]::WriteAllText((Join-Path $bundle "OBS_SOURCE_COMMIT"), "$commit`n", $utf8)
[IO.File]::WriteAllText((Join-Path $bundle "OBS_IMAGES"), ($manifest -join "`n") + "`n", $utf8)
Invoke-Docker (@("save", "-o", (Join-Path $bundle "obs-images.tar")) + $images)
$checksums = Get-ChildItem -LiteralPath $bundle -Recurse -File | Sort-Object FullName | ForEach-Object {
  $relative = $_.FullName.Substring($bundle.Length + 1).Replace('\', '/')
  "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $relative"
}
[IO.File]::WriteAllText((Join-Path $bundle "OBS_SHA256SUMS"), ($checksums -join "`n") + "`n", $utf8)
$archive = Join-Path $output "$Release.tar"
& tar -cf $archive -C $output $Release
if ($LASTEXITCODE -ne 0) { throw "Archive failed" }
[IO.File]::WriteAllText("$archive.sha256", "$((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower())  $Release.tar`n", $utf8)
Write-Output "Prepared $archive ($((Get-Item -LiteralPath $archive).Length) bytes). No upload or app changes performed."
