$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

$Files = @(
  "frontend/src/pages/collab/BalancesPage.jsx",
  "frontend/src/components/collab/balances/BalanceOverview.jsx",
  "frontend/src/components/collab/balances/BalanceMetric.jsx",
  "frontend/src/styles/balances.css",
  "frontend/src/styles/collab/balances/01-page.css",
  "frontend/src/styles/collab/balances/02-responsive.css"
)

foreach ($RelativePath in $Files) {
  $Path = Join-Path $Root $RelativePath
  if (Test-Path $Path) {
    Remove-Item $Path -Force
    Write-Host "Supprimé : $RelativePath"
  }
}

$EmptyDirs = @(
  "frontend/src/components/collab/balances",
  "frontend/src/styles/collab/balances"
)

foreach ($RelativePath in $EmptyDirs) {
  $Path = Join-Path $Root $RelativePath
  if ((Test-Path $Path) -and -not (Get-ChildItem $Path -Force | Select-Object -First 1)) {
    Remove-Item $Path -Force
    Write-Host "Dossier vide supprimé : $RelativePath"
  }
}

Write-Host "Nettoyage terminé. Les tables leave_balances et balance_movements ne sont pas touchées."
