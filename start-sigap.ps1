param(
  [ValidateSet('start','stop','status','verify','reset','cloud')]
  [string]$Action = 'start',
  [switch]$ConfirmLocalReset
)
$ErrorActionPreference = 'Stop'
$sigapRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
Set-Location -LiteralPath $sigapRoot
& docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker belum berjalan. Jalankan Docker Desktop terlebih dahulu.' }
if ($Action -eq 'cloud') {
  & docker compose -f docker-compose.yml up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'Gagal menjalankan konfigurasi cloud.' }
  return
}
$sigapEnv = Join-Path $sigapRoot '.env.sigap-local'
if ($Action -eq 'start' -and -not (Test-Path -LiteralPath $sigapEnv)) {
  & docker run --rm -it --mount "type=bind,source=$sigapRoot,target=/work" -w /work node:22-alpine node deployment/local/setup.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Setup lokal tidak selesai.' }
}
if (-not (Test-Path -LiteralPath $sigapEnv)) { throw 'Jalankan .\start-sigap.ps1 terlebih dahulu.' }
# Compose prioritizes process variables over --env-file. Keep the local stack
# isolated even if the invoking shell contains cloud settings.
$savedEnv = @{}
foreach ($line in Get-Content -LiteralPath $sigapEnv) {
  if ($line -match '^([A-Z][A-Z0-9_]*)=') {
    $name = $Matches[1]
    $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
  }
}
try {
$sigapCompose = @('compose','-p','sigap-local','--env-file',$sigapEnv,'-f',(Join-Path $sigapRoot 'docker-compose.local.yml'))
switch ($Action) {
  'start' {
    & docker @sigapCompose up -d --build --wait --wait-timeout 900
    if ($LASTEXITCODE -ne 0) { throw 'Layanan belum siap. Periksa Docker dan pesan kesalahan di atas.' }
    & docker @sigapCompose run --rm --no-deps verify
    if ($LASTEXITCODE -ne 0) { throw 'Pemeriksaan lokal gagal; layanan tidak dinyatakan siap.' }
    Write-Host 'SIGAP: http://localhost:8080 | Akun: .sigap-local-accounts.txt | Inbox: http://localhost:8025'
  }
  'stop' { & docker @sigapCompose down }
  'status' { & docker @sigapCompose ps -a }
  'verify' { & docker @sigapCompose run --rm --no-deps verify }
  'reset' {
    if (-not $ConfirmLocalReset) { throw 'Reset menghapus data SIGAP lokal. Ulangi dengan -ConfirmLocalReset jika memang ingin menghapusnya.' }
    Write-Host 'Menghapus volume proyek sigap-local.'
    & docker @sigapCompose down --volumes --remove-orphans
  }
}
if ($LASTEXITCODE -ne 0) { throw 'Perintah Docker gagal.' }
} finally {
  foreach ($name in $savedEnv.Keys) {
    if ($null -eq $savedEnv[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
    else { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name], 'Process') }
  }
}
