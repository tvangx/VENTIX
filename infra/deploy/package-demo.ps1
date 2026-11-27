param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9.-]{0,60}$')][string]$Release,
  [string]$OutputDirectory = "dist/demo"
)
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../.."))
Set-Location -LiteralPath $root
$dirty = & git status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw "Commit reviewed source before packaging; working tree must be clean" }
$output = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
$bundle = Join-Path $output $Release
if (Test-Path -LiteralPath $bundle) { throw "Release directory already exists; choose a new release" }
New-Item -ItemType Directory -Path $bundle -Force | Out-Null
function Invoke-Docker([string[]]$Arguments) {
  # Docker progress uses stderr on success too; exit code decides success on Windows PowerShell.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & docker @Arguments; $dockerCode = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previousPreference }
  if ($dockerCode -ne 0) { throw "Docker command failed" }
}
$images = @()
foreach ($service in @("identity", "event", "booking", "payment", "ticket", "web")) {
  $image = "ticketing-demo/${service}:$Release"
  $existingImage = & docker image ls -q $image
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect image inventory" }
  if ($existingImage) { throw "Image release tag already exists: $image" }
  $dockerfile = if ($service -eq "web") { "apps/web/Dockerfile" } else { "infra/deploy/Dockerfile" }
  Invoke-Docker @("build", "--platform", "linux/amd64", "-f", $dockerfile, "--build-arg", "SERVICE=$service", "-t", $image, ".")
  $images += $image
}
# Only allowlisted runtime configuration is shipped. No .git, business source or env values.
$files = @(
  "infra/compose/docker-compose.prod.yml", "infra/compose/docker-compose.tunnel.yml", "infra/compose/docker-compose.apps.yml",
  "infra/kong/kong.prod.yml", "infra/kong/kong.demo.yml", "infra/kafka/create-topics.sh",
  "infra/postgres/prod-init/01-create-databases.sh", "infra/deploy/demo.sh", "infra/deploy/demo.env.example",
  "docs/ops/demo-deploy.md"
)
foreach ($file in $files) {
  $target = Join-Path $bundle $file
  New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination $target
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $bundle "release.env"), "DEMO_RELEASE=$Release`n", $utf8)
$commit = & git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw "Cannot identify source commit" }
[IO.File]::WriteAllText((Join-Path $bundle "SOURCE_COMMIT"), "$commit`n", $utf8)
Invoke-Docker (@("save", "-o", (Join-Path $bundle "images.tar")) + $images)
$manifest = @()
foreach ($image in $images) {
  $inspection = & docker image inspect $image --format '{{.Id}} {{.Os}}/{{.Architecture}}'
  if ($LASTEXITCODE -ne 0 -or $inspection -notmatch 'linux/amd64$') { throw "Invalid image platform" }
  $manifest += "$image $inspection"
}
[IO.File]::WriteAllText((Join-Path $bundle "IMAGES"), ($manifest -join "`n") + "`n", $utf8)
$checksums = Get-ChildItem -LiteralPath $bundle -Recurse -File | Sort-Object FullName | ForEach-Object {
  $relative = $_.FullName.Substring($bundle.Length + 1).Replace('\', '/')
  "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower())  $relative"
}
[IO.File]::WriteAllText((Join-Path $bundle "SHA256SUMS"), ($checksums -join "`n") + "`n", $utf8)
& (Join-Path $env:SystemRoot "System32/tar.exe") -cf (Join-Path $output "$Release.tar") -C $output $Release
if ($LASTEXITCODE -ne 0) { throw "Archive failed" }
$archive = Join-Path $output "$Release.tar"
[IO.File]::WriteAllText("$archive.sha256", "$((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower())  $Release.tar`n", $utf8)
Write-Output "Prepared $archive and checksum. No upload performed."
