param(
  [string]$EnvFile = ".env",
  [string]$MigrationFile = "database/migrations/20260806_align_schema_gmes.sql"
)

$ErrorActionPreference = "Stop"

function Read-EnvFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    throw "Le fichier d'environnement '$Path' est introuvable."
  }

  $values = @{}

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()

    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
      $parts = $line.Split('=', 2)
      $values[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
    }
  }

  return $values
}

function Find-MySqlTool {
  param([string]$ExecutableName)

  $command = Get-Command $ExecutableName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    "C:\xampp\mysql\bin\$ExecutableName.exe",
    "C:\wamp64\bin\mysql\mysql8.0.31\bin\$ExecutableName.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\$ExecutableName.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $laragonRoot = "C:\laragon\bin\mysql"
  if (Test-Path $laragonRoot) {
    $laragonTool = Get-ChildItem $laragonRoot -Recurse -Filter "$ExecutableName.exe" |
      Select-Object -First 1

    if ($laragonTool) {
      return $laragonTool.FullName
    }
  }

  throw "$ExecutableName est introuvable. Ajoutez MySQL au PATH ou adaptez le script à votre installation."
}

if (-not (Test-Path $MigrationFile)) {
  throw "Le fichier de migration '$MigrationFile' est introuvable."
}

$envValues = Read-EnvFile -Path $EnvFile
$hostName = if ($envValues.DB_HOST) { $envValues.DB_HOST } else { "localhost" }
$port = if ($envValues.DB_PORT) { $envValues.DB_PORT } else { "3306" }
$userName = if ($envValues.DB_USERNAME) { $envValues.DB_USERNAME } else { "root" }
$password = if ($envValues.ContainsKey('DB_PASSWORD')) { $envValues.DB_PASSWORD } else { "" }
$database = if ($envValues.DB_DATABASE) { $envValues.DB_DATABASE } else { "gestion_conges_gmes" }

$mysql = Find-MySqlTool -ExecutableName "mysql"
$mysqldump = Find-MySqlTool -ExecutableName "mysqldump"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDirectory = Join-Path (Get-Location) "database\backups"
New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$backupFile = Join-Path $backupDirectory "${database}_avant_migration_${timestamp}.sql"

$commonArgs = @(
  "--host=$hostName",
  "--port=$port",
  "--user=$userName",
  "--default-character-set=utf8mb4"
)

if ($password) {
  $commonArgs += "--password=$password"
}

Write-Host "Sauvegarde de la base '$database'..." -ForegroundColor Cyan
$dumpArgs = $commonArgs + @(
  "--single-transaction",
  "--routines",
  "--triggers",
  "--events",
  "--hex-blob",
  $database
)

& $mysqldump @dumpArgs | Set-Content -Encoding UTF8 $backupFile
if ($LASTEXITCODE -ne 0) {
  throw "La sauvegarde MySQL a échoué. La migration n'a pas été lancée."
}

if (-not (Test-Path $backupFile) -or (Get-Item $backupFile).Length -eq 0) {
  throw "Le fichier de sauvegarde est vide. La migration n'a pas été lancée."
}

Write-Host "Sauvegarde créée : $backupFile" -ForegroundColor Green
Write-Host "Application de la migration..." -ForegroundColor Cyan

$migrationSql = Get-Content -Raw -Encoding UTF8 $MigrationFile
$migrationSql | & $mysql @commonArgs $database

if ($LASTEXITCODE -ne 0) {
  Write-Host "La migration a échoué. Le backup reste disponible ici : $backupFile" -ForegroundColor Red
  throw "Échec de la migration MySQL."
}

Write-Host "Migration terminée avec succès." -ForegroundColor Green
Write-Host "Backup conservé : $backupFile" -ForegroundColor Green
Write-Host "Lancez maintenant : npm run build, puis npm run start:dev" -ForegroundColor Yellow
