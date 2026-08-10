param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$backendRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $backendRoot '.env'
$schemaPath = Join-Path $PSScriptRoot 'schema.sql'
$seedPath = Join-Path $PSScriptRoot 'seed.sql'
$verifyPath = Join-Path $PSScriptRoot 'verify-schema.sql'

function Read-DotEnv {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) {
      continue
    }

    $key = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()

    if (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'"))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$key] = $value
  }

  return $values
}

function Resolve-MySqlClient {
  $command = Get-Command mysql.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $fixedCandidates = @(
    'C:\xampp\mysql\bin\mysql.exe',
    'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe',
    'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe',
    'C:\Program Files\MariaDB 11.4\bin\mysql.exe',
    'C:\Program Files\MariaDB 10.11\bin\mysql.exe'
  )

  foreach ($candidate in $fixedCandidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $wildcardCandidates = @(
    'C:\wamp64\bin\mysql\*\bin\mysql.exe',
    'C:\wamp64\bin\mariadb\*\bin\mysql.exe'
  )

  foreach ($pattern in $wildcardCandidates) {
    $candidate = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -First 1

    if ($candidate) {
      return $candidate.FullName
    }
  }

  throw 'mysql.exe est introuvable. Ajoute le dossier MySQL au PATH ou adapte Resolve-MySqlClient dans ce script.'
}

function Quote-NativeArgument {
  param([string]$Value)

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-MySqlFile {
  param(
    [string]$MySql,
    [string]$SqlFile,
    [string[]]$Arguments
  )

  if (-not (Test-Path $SqlFile)) {
    throw "Fichier SQL introuvable : $SqlFile"
  }

  Write-Host "Exécution de $(Split-Path -Leaf $SqlFile)..." -ForegroundColor Cyan

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $MySql
  $startInfo.Arguments = ($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true
  $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false

  # Windows PowerShell 5.1 ne fournit pas toujours StandardInputEncoding.
  # Les propriétés de sortie sont donc appliquées uniquement lorsqu'elles existent.
  if ($startInfo.PSObject.Properties['StandardOutputEncoding']) {
    $startInfo.StandardOutputEncoding = $utf8NoBom
  }

  if ($startInfo.PSObject.Properties['StandardErrorEncoding']) {
    $startInfo.StandardErrorEncoding = $utf8NoBom
  }

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo

  if (-not $process.Start()) {
    throw "Impossible de démarrer mysql.exe pour $SqlFile"
  }

  # Envoi binaire du fichier SQL pour conserver exactement son UTF-8,
  # sans dépendre de l'encodage de la console PowerShell.
  $sqlBytes = [System.IO.File]::ReadAllBytes($SqlFile)
  $inputStream = $process.StandardInput.BaseStream
  $inputStream.Write($sqlBytes, 0, $sqlBytes.Length)
  $inputStream.Flush()
  $inputStream.Close()

  $standardOutput = $process.StandardOutput.ReadToEnd()
  $standardError = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  if ($standardOutput) {
    Write-Host $standardOutput.TrimEnd()
  }

  if ($process.ExitCode -ne 0) {
    if ($standardError) {
      Write-Host $standardError.TrimEnd() -ForegroundColor Red
    }

    throw "Échec de l'exécution SQL : $SqlFile"
  }

  if ($standardError) {
    Write-Host $standardError.TrimEnd() -ForegroundColor Yellow
  }
}

$configuration = Read-DotEnv -Path $envPath
$dbHost = if ($configuration.ContainsKey('DB_HOST')) { $configuration['DB_HOST'] } else { 'localhost' }
$dbPort = if ($configuration.ContainsKey('DB_PORT')) { $configuration['DB_PORT'] } else { '3306' }
$dbUser = if ($configuration.ContainsKey('DB_USERNAME')) { $configuration['DB_USERNAME'] } else { 'root' }
$dbPassword = if ($configuration.ContainsKey('DB_PASSWORD')) { $configuration['DB_PASSWORD'] } else { '' }
$dbName = if ($configuration.ContainsKey('DB_DATABASE')) { $configuration['DB_DATABASE'] } else { 'gestion_conges_gmes' }

if ($dbName -ne 'gestion_conges_gmes') {
  throw "DB_DATABASE doit être gestion_conges_gmes pour correspondre au diagramme. Valeur actuelle : $dbName"
}

if (-not $Force) {
  Write-Host ''
  Write-Host 'ATTENTION : toutes les tables et toutes les données de gestion_conges_gmes vont être supprimées.' -ForegroundColor Yellow
  $confirmation = Read-Host 'Tape OUI pour recréer entièrement la base'
  if ($confirmation -cne 'OUI') {
    Write-Host 'Opération annulée.' -ForegroundColor Yellow
    exit 0
  }
}

$mysql = Resolve-MySqlClient
$mysqlArguments = @(
  "--host=$dbHost",
  "--port=$dbPort",
  "--user=$dbUser",
  '--default-character-set=utf8mb4',
  '--protocol=tcp'
)

$previousMySqlPassword = $env:MYSQL_PWD
try {
  $env:MYSQL_PWD = $dbPassword

  Invoke-MySqlFile -MySql $mysql -SqlFile $schemaPath -Arguments $mysqlArguments
  Invoke-MySqlFile -MySql $mysql -SqlFile $seedPath -Arguments $mysqlArguments
  Invoke-MySqlFile -MySql $mysql -SqlFile $verifyPath -Arguments $mysqlArguments

  Write-Host ''
  Write-Host 'Base gestion_conges_gmes recréée avec succès.' -ForegroundColor Green
  Write-Host '13 tables conformes au diagramme ont été créées.' -ForegroundColor Green
  Write-Host 'Compte initial : admin@gmes.fr (mot de passe à définir via /api/auth/request-password).' -ForegroundColor Green
}
finally {
  $env:MYSQL_PWD = $previousMySqlPassword
}