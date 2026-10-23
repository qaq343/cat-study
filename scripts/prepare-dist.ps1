$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $projectRoot 'dist'
$expectedDist = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
if ([System.IO.Path]::GetFullPath($dist) -ne $expectedDist) { throw 'Unexpected build output path' }
if ((Test-Path -LiteralPath $dist) -and ((Get-Item -LiteralPath $dist).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'Refusing to replace a linked build directory' }
if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'index.html'),(Join-Path $projectRoot 'progress.html'),(Join-Path $projectRoot 'companion.html') -Destination $dist
foreach ($folder in 'assets','css') { Copy-Item -LiteralPath (Join-Path $projectRoot $folder) -Destination $dist -Recurse }
# Retired scheduling data/code stay out of the installed program. Lesson notes
# and annotations have their own small store and file; no live plan is bundled.
foreach ($folder in 'data','js') {
  $destination = Join-Path $dist $folder
  New-Item -ItemType Directory -Path $destination | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $projectRoot $folder) -File | Where-Object { $_.Name -notin @('study-plan.json','planner-ui.js','planner-core.js') } | Copy-Item -Destination $destination
}
