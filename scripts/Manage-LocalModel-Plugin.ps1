param(
  [ValidateSet('Install', 'Uninstall', 'Status', 'PublishVersion', 'RollbackVersion')]
  [string]$Action = 'Status',
  [string]$HomeDir = '',
  [string]$Version = '',
  [string]$Summary = '',
  [string]$TargetTag = ''
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PatchScript = Join-Path $PSScriptRoot 'patch-host.cjs'
$ChangelogFile = Join-Path $RepoRoot 'CHANGELOG.md'
$PackageJsonFile = Join-Path $RepoRoot 'package.json'
$ReceiptFile = Join-Path $RepoRoot 'backups\manage-receipt.json'

function Ensure-DSHStopped {
  $procs = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
  if ($procs) {
    Write-Host '[1/3] 正在关闭运行中的 DeepSeek Harness 进程...' -ForegroundColor Yellow
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
  }
}

switch ($Action) {
  'Install' {
    Ensure-DSHStopped
    $argsList = @($PatchScript, '--install')
    if ($HomeDir) { $argsList += @('--home', $HomeDir) }
    $out = & node @argsList
    $out | Set-Content -LiteralPath $ReceiptFile -Encoding UTF8
    Write-Host $out -ForegroundColor Green
  }
  'Uninstall' {
    Ensure-DSHStopped
    $argsList = @($PatchScript, '--uninstall')
    if ($HomeDir) { $argsList += @('--home', $HomeDir) }
    $out = & node @argsList
    $out | Set-Content -LiteralPath $ReceiptFile -Encoding UTF8
    Write-Host $out -ForegroundColor Cyan
  }
  'PublishVersion' {
    if (-not $Version -or -not $Summary) {
      throw 'PublishVersion 必须提供 -Version (如 0.2.0) 与 -Summary (变更摘要)'
    }
    Push-Location $RepoRoot
    try {
      $pkg = Get-Content -LiteralPath $PackageJsonFile -Raw | ConvertFrom-Json
      $pkg.version = $Version
      ($pkg | ConvertTo-Json -Depth 10) + "`n" | Set-Content -LiteralPath $PackageJsonFile -Encoding UTF8

      $dateStr = Get-Date -Format 'yyyy-MM-dd'
      $entry = "## [$Version] - $dateStr`r`n### 变更摘要`r`n- $Summary`r`n`r`n"
      $oldLog = if (Test-Path -LiteralPath $ChangelogFile) { Get-Content -LiteralPath $ChangelogFile -Raw } else { "# Changelog`r`n`r`n" }
      $newLog = $oldLog -replace '(# Changelog\r?\n\r?\n)', "`$1$entry"
      $newLog | Set-Content -LiteralPath $ChangelogFile -Encoding UTF8

      git add -A
      git commit -m "release(v$Version): $Summary"
      git tag -a "v$Version" -m "Release v$Version : $Summary"
      @{ ok = $true; action = 'PublishVersion'; version = "v$Version"; summary = $Summary; date = $dateStr } | ConvertTo-Json | Set-Content -LiteralPath $ReceiptFile -Encoding UTF8
      Write-Host "已生成版本 v$Version 并写入 CHANGELOG.md 与 Git Tag。" -ForegroundColor Green
    } finally {
      Pop-Location
    }
  }
  'RollbackVersion' {
    if (-not $TargetTag) {
      throw 'RollbackVersion 必须提供 -TargetTag (如 v0.1.0)'
    }
    Ensure-DSHStopped
    Push-Location $RepoRoot
    try {
      git checkout $TargetTag
      & node $PatchScript --install
      @{ ok = $true; action = 'RollbackVersion'; targetTag = $TargetTag; rolledBackAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $ReceiptFile -Encoding UTF8
      Write-Host "已回滚至版本 $TargetTag 并同步重新安装至 DSH。" -ForegroundColor Cyan
    } finally {
      Pop-Location
    }
  }
  'Status' {
    Push-Location $RepoRoot
    try {
      $tags = git tag -l -n1 2>$null
      $branch = git status -sb 2>$null
      @{ ok = $true; repo = $RepoRoot; gitStatus = $branch; tags = $tags } | ConvertTo-Json | Set-Content -LiteralPath $ReceiptFile -Encoding UTF8
      Get-Content -LiteralPath $ReceiptFile
    } finally {
      Pop-Location
    }
  }
}

explorer.exe /select,"$ReceiptFile"
