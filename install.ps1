#Requires -Version 5.1
<#
    Unreal_AIHper framework initializer.
    Run AFTER `git clone --recurse-submodules` into <UEProject>/Plugins/Unreal.AIHper/.

    This script does NOT clone or copy sources (the repo IS the plugin directory).
    It performs one-shot project initialization:
      - npm install (puerts_uehper via file: dep)
      - puerts_uehper bootstrap (tsconfig.paths, GameApp.ts, Manifests)
      - Falls back to seeding package.json/tsconfig.json/TypeScript/ if missing
      - Optional: -WithMCP adds McpAutomationBridge to .uproject Plugins array

    Usage:
      cd <UEProject>/Plugins/Unreal.AIHper
      ./install.ps1 -ProjectRoot ../..

    Or from UE project root:
      ./Plugins/Unreal.AIHper/install.ps1 -ProjectRoot .
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ProjectRoot,
    [switch] $WithMCP,
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Resolve project root to absolute path
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$FrameworkRoot = $PSScriptRoot  # this script lives in the cloned repo root

function Write-Info($msg) { Write-Host "[Unreal_AIHper] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[Unreal_AIHper] WARN: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[Unreal_AIHper] ERROR: $msg" -ForegroundColor Red }

Write-Info "ProjectRoot: $ProjectRoot"
Write-Info "FrameworkRoot: $FrameworkRoot"

# --- sanity checks ---
if (-not (Test-Path (Join-Path $FrameworkRoot "UEHper/UEHper.uplugin"))) {
    Write-Err "UEHper.uplugin not found under $FrameworkRoot/UEHper/. Did you git clone --recurse-submodules?"
    exit 1
}
if (-not (Test-Path (Join-Path $FrameworkRoot "puerts_uehper/package.json"))) {
    Write-Err "puerts_uehper/package.json not found under $FrameworkRoot. Did you git clone --recurse-submodules?"
    exit 1
}
$uproject = Get-ChildItem $ProjectRoot -Filter *.uproject -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $uproject) {
    Write-Err "No .uproject under $ProjectRoot. Is this a UE project root?"
    exit 1
}

# --- 1. seed package.json in ProjectRoot if missing ---
$pkgPath = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path $pkgPath)) {
    Write-Info "Creating package.json (not found in project root)"
    $projName = Split-Path $ProjectRoot -Leaf
    $pkgSeed = @{
        name = $projName
        version = "0.0.0"
        private = $true
        dependencies = @{
            puerts_uehper = "file:Plugins/Unreal.AIHper/puerts_uehper"
        }
        devDependencies = @{
            "@types/node" = "^20.5.9"
        }
        scripts = @{
            build = "puerts_uehper build"
            watch = "puerts_uehper watch"
        }
        uehper = @{
            sourceRoot = "TypeScript"
            appDir = "."
            entryModule = "GameApp"
            frameworkSource = "package"
        }
    }
    if (-not $DryRun) { $pkgSeed | ConvertTo-Json -Depth 10 | Set-Content $pkgPath -Encoding UTF8 }
} else {
    # ensure puerts_uehper dep exists
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if (-not $pkg.dependencies -or -not $pkg.dependencies.'puerts_uehper') {
        Write-Info "Adding puerts_uehper dependency to package.json"
        if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue @{} }
        $pkg.dependencies.'puerts_uehper' = "file:Plugins/Unreal.AIHper/puerts_uehper"
        if (-not $DryRun) { $pkg | ConvertTo-Json -Depth 10 | Set-Content $pkgPath -Encoding UTF8 }
    }
}

# --- 2. seed tsconfig.json if missing ---
$tsconfigPath = Join-Path $ProjectRoot "tsconfig.json"
if (-not (Test-Path $tsconfigPath)) {
    Write-Info "Creating tsconfig.json (minimal; bootstrap will refine paths)"
    $tsconfigSeed = @{
        compilerOptions = @{
            target = "esnext"
            module = "commonjs"
            experimentalDecorators = $true
            useDefineForClassFields = $false
            jsx = "react"
            sourceMap = $true
            skipLibCheck = $true
            baseUrl = "TypeScript"
            paths = @{
                "puerts_uehper" = @("../node_modules/puerts_uehper/dist/index")
                "puerts_uehper/*" = @("../node_modules/puerts_uehper/dist/*")
            }
            typeRoots = @("Typing", "./node_modules/@types")
            outDir = "Content/JavaScript/Game"
        }
        include = @("TypeScript/**/*")
        exclude = @("Typing/**/*.d.ts", "TypeScript/puerts_uehper/IOToolkit/**/*")
    }
    if (-not $DryRun) { $tsconfigSeed | ConvertTo-Json -Depth 10 | Set-Content $tsconfigPath -Encoding UTF8 }
}

# --- 3. ensure TypeScript/ source root exists ---
$tsRoot = Join-Path $ProjectRoot "TypeScript"
if (-not (Test-Path $tsRoot) -and -not $DryRun) {
    Write-Info "Creating TypeScript/ source root"
    New-Item -ItemType Directory -Path $tsRoot -Force | Out-Null
}

# --- 4. npm install ---
Write-Info "npm install (in $ProjectRoot)"
if (-not $DryRun) {
    Push-Location $ProjectRoot
    try {
        & npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed (exit $LASTEXITCODE)"; exit 1 }
    } finally { Pop-Location }
}

# --- 5. puerts_uehper bootstrap ---
Write-Info "npx puerts_uehper bootstrap"
if (-not $DryRun) {
    Push-Location $ProjectRoot
    try {
        & npx --no-install puerts_uehper bootstrap
        $bsExit = $LASTEXITCODE
        if ($bsExit -ne 0) {
            Write-Warn "bootstrap exited $bsExit (expected if Puerts backend not yet compiled)"
            Write-Warn "next steps:"
            Write-Warn "  1. Compile C++ (build UEHper + Puerts modules)"
            Write-Warn "  2. Launch UE editor, run Puerts.Gen (or npx puerts_uehper gen-typings)"
            Write-Warn "  3. Re-run: npx puerts_uehper bootstrap"
            Write-Warn "  4. npx puerts_uehper build"
        }
    } finally { Pop-Location }
}

# --- 6. optional: enable McpAutomationBridge in .uproject ---
if ($WithMCP) {
    Write-Info "Enabling McpAutomationBridge in .uproject"
    $mcpBridge = Join-Path $FrameworkRoot "Unreal_mcp/plugins/McpAutomationBridge/McpAutomationBridge.uplugin"
    if (-not (Test-Path $mcpBridge)) {
        Write-Warn "McpAutomationBridge.uplugin not found at $mcpBridge. Did you init Unreal_mcp submodule?"
    } else {
        # junction McpAutomationBridge into repo root for UE to discover
        $mcpLink = Join-Path $FrameworkRoot "McpAutomationBridge"
        if (-not (Test-Path $mcpLink) -and -not $DryRun) {
            Write-Info "  linking McpAutomationBridge -> $mcpLink"
            cmd /c mklink /J "$mcpLink" "$((Split-Path $mcpBridge -Parent))"
        }
        # add to .uproject Plugins array
        if (-not $DryRun) {
            $up = Get-Content $uproject.FullName -Raw | ConvertFrom-Json
            if (-not $up.Plugins) { $up | Add-Member -NotePropertyName Plugins -NotePropertyValue @() }
            $exists = $up.Plugins | Where-Object { $_.Name -eq "McpAutomationBridge" }
            if (-not $exists) {
                $up.Plugins += @{ Name = "McpAutomationBridge"; Enabled = $true }
                $up | ConvertTo-Json -Depth 10 | Set-Content $uproject.FullName -Encoding UTF8
                Write-Info "  added McpAutomationBridge to $($uproject.Name)"
            }
        }
    }
}

# --- 7. SVN detection ---
if (Test-Path (Join-Path $ProjectRoot ".svn")) {
    Write-Warn "SVN working copy detected. The .git under Plugins/Unreal.AIHper/ should be svn:ignored:"
    Write-Warn "  svn propset svn:ignore '.git' Plugins/Unreal.AIHper"
    Write-Warn "  (or ignore the whole Plugins/Unreal.AIHper if you don't track framework version via SVN)"
}

# --- 8. write version record ---
$verIni = Join-Path $FrameworkRoot "UEHper/Config/UEHperFrameworkVersion.ini"
$gitVer = "unknown"
try { $gitVer = (git -C $FrameworkRoot describe --tags --always 2>$null) } catch {}
if (-not $gitVer) { $gitVer = "unknown" }
Write-Info "Writing version record: $verIni (version=$gitVer)"
if (-not $DryRun) {
    $verContent = "Version=$gitVer`r`nInstalledAt=$(Get-Date -Format o)`r`nSource=git clone"
    Set-Content -Path $verIni -Value $verContent -Encoding UTF8
}

# --- done ---
Write-Info ""
Write-Info "Initialization complete."
Write-Info "Framework git repo: $FrameworkRoot"
Write-Info "To update framework: cd $FrameworkRoot; git pull --recurse-submodules"
Write-Info "To push framework changes: cd $FrameworkRoot; git add -A; git commit -m '...'; git push"
Write-Info ""
Write-Info "Next steps:"
Write-Info "  cd $ProjectRoot"
Write-Info "  npx puerts_uehper doctor    # validate layout"
Write-Info "  (compile C++ if backend missing)"
Write-Info "  npx puerts_uehper gen-typings   # after launching UE editor"
Write-Info "  npx puerts_uehper build          # compile TypeScript"
