#Requires -Version 5.1
<#
    Unreal_AIHper framework installer.
    Integrates UEHper + puerts_uehper + Puerts + optional McpAutomationBridge
    into any UE 5.5 project. Pure-network mode (GitHub + npm), no local path assumptions.

    See docs/uehper-monorepo-plan.md §5 for architecture.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ProjectRoot,
    [string] $Version = "latest",
    [string] $LocalSource,
    [switch] $Force,
    [switch] $WithMCP,
    [ValidateSet("All", "Fetch", "Integrate", "Configure")] [string] $Stage = "All",
    [switch] $DryRun,
    [switch] $SkipConfigure
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoOwner = "MrBaoquan"        # TODO: confirm before push
$RepoName = "Unreal_AIHper"
$RepoUrl = "https://github.com/$RepoOwner/$RepoName.git"
$InstallerRawUrl = "https://raw.githubusercontent.com/$RepoOwner/$RepoName/main/install.ps1"

$PluginsRoot = Join-Path $ProjectRoot "Plugins/Unreal.AIHper"
$TempDir = Join-Path $env:TEMP "Unreal_AIHper_$(Get-Random -Maximum 1000000)"
$script:SourceRoot = $null

function Write-StageInfo($msg) { Write-Host "[Unreal_AIHper] $msg" -ForegroundColor Cyan }
function Write-StageWarn($msg) { Write-Host "[Unreal_AIHper] WARN: $msg" -ForegroundColor Yellow }
function Write-StageError($msg) { Write-Host "[Unreal_AIHper] ERROR: $msg" -ForegroundColor Red }

function Assert-ProjectRoot {
    if (-not (Test-Path $ProjectRoot)) { throw "ProjectRoot not found: $ProjectRoot" }
    $uproject = Get-ChildItem $ProjectRoot -Filter *.uproject -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $uproject) { throw "No .uproject under $ProjectRoot. Is this a UE project root?" }
}

function Invoke-Fetch {
    Write-StageInfo "L1 Fetch: acquiring framework source"
    if ($LocalSource) {
        Write-StageInfo "  using local source: $LocalSource"
        if (-not (Test-Path $LocalSource)) { throw "LocalSource not found: $LocalSource" }
        $script:SourceRoot = $LocalSource
        return
    }
    $branch = if ($Version -eq "latest") { "main" } else { $Version }
    Write-StageInfo "  git clone --recurse-submodules --branch $branch -> $TempDir"
    if ($DryRun) { $script:SourceRoot = "<dry-run>"; return }
    & git clone --recurse-submodules --branch $branch $RepoUrl $TempDir
    if ($LASTEXITCODE -ne 0) { throw "git clone failed (exit $LASTEXITCODE)" }
    $script:SourceRoot = $TempDir
}

function Get-SubDirSourcePath($sub) {
    switch ($sub) {
        "UEHper"              { Join-Path $script:SourceRoot "Plugins/UEHper" }
        "puerts_uehper"       { Join-Path $script:SourceRoot "Plugins/puerts_uehper" }
        "puerts"              { Join-Path $script:SourceRoot "ThirdParty/puerts" }
        "McpAutomationBridge" { Join-Path $script:SourceRoot "ThirdParty/Unreal_mcp/plugins/McpAutomationBridge" }
        default { throw "Unknown sub dir: $sub" }
    }
}

function Invoke-Integrate {
    Write-StageInfo "L2 Integrate: copying framework to $PluginsRoot"
    $subDirs = @("UEHper", "puerts_uehper", "puerts")
    if ($WithMCP) { $subDirs += "McpAutomationBridge" }

    if (-not (Test-Path $PluginsRoot) -and -not $DryRun) { New-Item -ItemType Directory -Path $PluginsRoot -Force | Out-Null }

    foreach ($sub in $subDirs) {
        $src = Get-SubDirSourcePath $sub
        $dst = Join-Path $PluginsRoot $sub
        if (-not (Test-Path $src)) { Write-StageWarn "  source missing, skip: $src"; continue }

        if ($Force -and (Test-Path $dst)) {
            Write-StageInfo "  -Force: remove old $dst"
            if (-not $DryRun) { Remove-Item -Recurse -Force $dst }
        }
        if (Test-Path $dst) {
            Write-StageInfo "  exists, skip (use -Force to reinstall): $dst"
            continue
        }
        Write-StageInfo "  copy: $src -> $dst"
        if (-not $DryRun) {
            # Exclude build artifacts
            & robocopy $src $dst /E /XD .git Binaries Intermediate node_modules /XF *.tsbuildinfo /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $sub (exit $LASTEXITCODE)" }
        }
    }

    # Version record
    $verIni = Join-Path $PluginsRoot "UEHper/Config/UEHperFrameworkVersion.ini"
    Write-StageInfo "  write version record: $verIni"
    if (-not $DryRun) {
        $verDir = Split-Path $verIni -Parent
        if (-not (Test-Path $verDir)) { New-Item -ItemType Directory -Path $verDir -Force | Out-Null }
        $verContent = "Version=$Version`r`nInstalledAt=$(Get-Date -Format o)`r`nSource=$($script:SourceRoot)"
        Set-Content -Path $verIni -Value $verContent -Encoding UTF8
    }

    # SVN detection
    if (Test-Path (Join-Path $ProjectRoot ".svn")) {
        Write-StageWarn "SVN working copy detected. Set svn:ignore on the 4 framework dirs:"
        Write-StageWarn "  svn propset svn:ignore -R 'UEHper`npuerts_uehper`npuerts`nMcpAutomationBridge' Plugins/Unreal.AIHper"
    }
}

function Invoke-Configure {
    if ($SkipConfigure) { Write-StageInfo "L3 Configure: skipped (-SkipConfigure)"; return }
    Write-StageInfo "L3 Configure: npm install + puerts_uehper bootstrap"

    $pkgPath = Join-Path $ProjectRoot "package.json"
    $tsconfigPath = Join-Path $ProjectRoot "tsconfig.json"
    $backup = @{}
    foreach ($f in @($pkgPath, $tsconfigPath)) {
        if (Test-Path $f) { $backup[$f] = (Get-Content $f -Raw) }
    }

    try {
        Push-Location $ProjectRoot
        if ($DryRun) { Write-StageInfo "  [dry-run] npm install + npx puerts_uehper bootstrap"; return }

        # Ensure puerts_uehper dep in package.json
        if (Test-Path $pkgPath) {
            $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
            if (-not $pkg.dependencies -or -not $pkg.dependencies.'puerts_uehper') {
                Write-StageInfo "  adding puerts_uehper dep to package.json"
                if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue @{} }
                $pkg.dependencies.'puerts_uehper' = "file:Plugins/Unreal.AIHper/puerts_uehper"
                $pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgPath -Encoding UTF8
            }
        }

        Write-StageInfo "  npm install"
        & npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)" }

        Write-StageInfo "  npx puerts_uehper bootstrap"
        & npx --no-install puerts_uehper bootstrap
        if ($LASTEXITCODE -ne 0) { throw "bootstrap failed (exit $LASTEXITCODE)" }
    }
    catch {
        Write-StageError "L3 failed: $($_.Exception.Message)"
        Write-StageWarn "  restoring config files from backup"
        foreach ($f in $backup.Keys) { Set-Content $f $backup[$f] -Encoding UTF8 }
        throw
    }
    finally {
        Pop-Location
    }
}

# --- Main ---
Write-StageInfo "Unreal_AIHper installer -> $ProjectRoot (version=$Version, stage=$Stage)"
Assert-ProjectRoot

if ($Stage -in @("All", "Fetch"))    { Invoke-Fetch }
if ($Stage -in @("All", "Integrate")) { Invoke-Integrate }
if ($Stage -in @("All", "Configure")) { Invoke-Configure }

# Cleanup temp
if ($TempDir -and (Test-Path $TempDir)) {
    Write-StageInfo "cleanup temp: $TempDir"
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}

Write-StageInfo "Done. Next: cd $ProjectRoot; npx puerts_uehper doctor"
