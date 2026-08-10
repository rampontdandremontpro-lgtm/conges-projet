$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$databaseRoot = $PSScriptRoot
$backendRoot = Split-Path -Parent $databaseRoot
$envPath = Join-Path $backendRoot '.env'
$sqlPath = Join-Path $databaseRoot 'seed-test-accounts.sql'

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

  foreach ($pattern in @(
    'C:\wamp64\bin\mysql\*\bin\mysql.exe',
    'C:\wamp64\bin\mariadb\*\bin\mysql.exe'
  )) {
    $candidate = Get-ChildItem -Path $pattern -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -First 1

    if ($candidate) {
      return $candidate.FullName
    }
  }

  throw 'mysql.exe est introuvable.'
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

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $MySql
  $startInfo.Arguments = ($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
  if ($startInfo.PSObject.Properties['StandardOutputEncoding']) {
    $startInfo.StandardOutputEncoding = $utf8NoBom
  }
  if ($startInfo.PSObject.Properties['StandardErrorEncoding']) {
    $startInfo.StandardErrorEncoding = $utf8NoBom
  }

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo

  if (-not $process.Start()) {
    throw 'Impossible de démarrer mysql.exe.'
  }

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
  throw "DB_DATABASE doit être gestion_conges_gmes. Valeur actuelle : $dbName"
}

$mysql = Resolve-MySqlClient
$arguments = @(
  "--host=$dbHost",
  "--port=$dbPort",
  "--user=$dbUser",
  '--default-character-set=utf8mb4',
  '--protocol=tcp'
)

$previousMySqlPassword = $env:MYSQL_PWD
try {
  $env:MYSQL_PWD = $dbPassword
  Write-Host 'Création ou mise à jour des cinq comptes de test...' -ForegroundColor Cyan
  Invoke-MySqlFile -MySql $mysql -SqlFile $sqlPath -Arguments $arguments
  Write-Host ''
  Write-Host 'Comptes de test prêts.' -ForegroundColor Green
  Write-Host 'Aucune table et aucune autre donnée métier n’ont été supprimées.' -ForegroundColor Green
}
finally {
  $env:MYSQL_PWD = $previousMySqlPassword
}
