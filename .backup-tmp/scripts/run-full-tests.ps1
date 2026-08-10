param(
  [switch]$ExternalApi
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

$backendRoot = Split-Path -Parent $PSScriptRoot
$resultsRoot = Join-Path $backendRoot 'test-results'
$storageRoot = Join-Path $backendRoot 'storage\test-private'
$stdoutPath = Join-Path $resultsRoot 'api-test.stdout.log'
$stderrPath = Join-Path $resultsRoot 'api-test.stderr.log'
$testDatabase = 'gestion_conges_gmes_test'
$testPort = '3010'
$apiUrl = "http://localhost:$testPort/api"
$apiProcess = $null

New-Item -ItemType Directory -Path $resultsRoot -Force | Out-Null
if (Test-Path $storageRoot) {
  Remove-Item -Path $storageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $storageRoot -Force | Out-Null
Remove-Item $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '1/5 Compilation du backend...' -ForegroundColor Cyan
Push-Location $backendRoot
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw 'La compilation du backend a échoué.'
  }

  Write-Host ''
  Write-Host '2/5 Exécution des tests unitaires...' -ForegroundColor Cyan
  & npm run test:unit
  if ($LASTEXITCODE -ne 0) {
    throw 'Les tests unitaires ont échoué.'
  }

  Write-Host ''
  Write-Host '3/5 Reconstruction de la base de test isolée...' -ForegroundColor Cyan
  $env:TEST_DB_DATABASE = $testDatabase
  & node .\scripts\reset-test-database.mjs
  if ($LASTEXITCODE -ne 0) {
    throw 'La reconstruction de la base de test a échoué.'
  }

  Write-Host ''
  Write-Host "4/5 Démarrage temporaire de l'API sur le port $testPort..." -ForegroundColor Cyan
  $env:DB_DATABASE = $testDatabase
  $env:PORT = $testPort
  $env:PRIVATE_STORAGE_ROOT = $storageRoot
  $env:API_URL = $apiUrl
  if ($ExternalApi) {
    $env:RUN_EXTERNAL_API_TESTS = 'true'
  }
  else {
    $env:RUN_EXTERNAL_API_TESTS = 'false'
  }

  $apiProcess = Start-Process `
    -FilePath 'node' `
    -ArgumentList '.\dist\main.js' `
    -WorkingDirectory $backendRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru `
    -WindowStyle Hidden

  $ready = $false
  for ($attempt = 1; $attempt -le 60; $attempt++) {
    if ($apiProcess.HasExited) {
      throw "L'API de test s'est arrêtée avant d'être prête. Consulte $stderrPath"
    }

    try {
      $response = Invoke-WebRequest -Uri $apiUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    }
    catch {
      Start-Sleep -Seconds 1
    }
  }

  if (-not $ready) {
    throw "L'API de test n'a pas répondu dans le délai imparti. Consulte $stderrPath"
  }

  Write-Host ''
  Write-Host '5/5 Exécution des parcours complets et des contrôles de confidentialité...' -ForegroundColor Cyan
  & node .\scripts\full-functional-test.mjs
  $testExitCode = $LASTEXITCODE

  Write-Host ''
  if ($testExitCode -eq 0) {
    Write-Host 'SUCCÈS — tous les contrôles obligatoires sont conformes.' -ForegroundColor Green
    Write-Host "Rapports : $resultsRoot" -ForegroundColor Green
  }
  else {
    Write-Host 'ÉCHEC — au moins un contrôle est en erreur.' -ForegroundColor Red
    Write-Host "Rapports : $resultsRoot" -ForegroundColor Yellow
    exit $testExitCode
  }
}
finally {
  if ($apiProcess -and -not $apiProcess.HasExited) {
    Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    $apiProcess.WaitForExit()
  }
  Pop-Location
}
