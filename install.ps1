#Requires -Version 5.1
<#
    Unreal_AIHper framework initializer.
    Run AFTER `git clone --recurse-submodules` into <UEProject>/Plugins/Unreal.AIHper/.

    One-shot project initialization:
      - seed package.json / tsconfig.json / TypeScript/ if missing
      - npm install (puerts_uehper via file: dep)
      - npx puerts_uehper bootstrap (tsconfig.paths, GameApp.ts, Manifests)
      - strip UTF-8 BOM from .uproject (Node JSON.parse fails on BOM)
      - write version record

    Usage:
      cd <UEProjectRoot>
      git clone --recurse-submodules https://github.com/MrBaoquan/Unreal_AIHper.git Plugins/Unreal.AIHper
      ./Plugins/Unreal.AIHper/install.ps1 -ProjectRoot .

    For MCP editor automation, see README.md "Optional: McpAutomationBridge".
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ProjectRoot
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$FrameworkRoot = $PSScriptRoot
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Info($msg) { Write-Host "[Unreal_AIHper] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[Unreal_AIHper] WARN: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[Unreal_AIHper] ERROR: $msg" -ForegroundColor Red }

function Write-JsonFile([string]$path, $obj) {
    $json = $obj | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($path, $json, $Utf8NoBom)
}

function Write-TextFile([string]$path, [string]$text) {
    [System.IO.File]::WriteAllText($path, $text, $Utf8NoBom)
}

function Remove-Bom([string]$path) {
    if (-not (Test-Path $path)) { return }
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        Write-Info "Removing UTF-8 BOM from $path"
        $stripped = New-Object byte[] ($bytes.Length - 3)
        [Array]::Copy($bytes, 3, $stripped, 0, $stripped.Length)
        [System.IO.File]::WriteAllBytes($path, $stripped)
    }
}

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

# Strip BOM from .uproject (Node JSON.parse fails on BOM; bootstrap reads it)
Remove-Bom $uproject.FullName

# --- 1. seed package.json if missing ---
$pkgPath = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path $pkgPath)) {
    Write-Info "Creating package.json"
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
    Write-JsonFile $pkgPath $pkgSeed
} else {
    $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
    if (-not $pkg.dependencies -or -not $pkg.dependencies.'puerts_uehper') {
        Write-Info "Adding puerts_uehper dependency to package.json"
        if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue @{} }
        $pkg.dependencies.'puerts_uehper' = "file:Plugins/Unreal.AIHper/puerts_uehper"
        Write-JsonFile $pkgPath $pkg
    }
}

# --- 2. seed tsconfig.json if missing ---
$tsconfigPath = Join-Path $ProjectRoot "tsconfig.json"
if (-not (Test-Path $tsconfigPath)) {
    Write-Info "Creating tsconfig.json (bootstrap will refine paths)"
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
    Write-JsonFile $tsconfigPath $tsconfigSeed
}

# --- 3. ensure TypeScript/ source root exists ---
$tsRoot = Join-Path $ProjectRoot "TypeScript"
if (-not (Test-Path $tsRoot)) {
    Write-Info "Creating TypeScript/ source root"
    New-Item -ItemType Directory -Path $tsRoot -Force | Out-Null
}

# --- 4. npm install ---
Write-Info "npm install"
Push-Location $ProjectRoot
try {
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install failed (exit $LASTEXITCODE)"; exit 1 }
} finally { Pop-Location }

# --- 5. puerts_uehper bootstrap ---
Write-Info "npx puerts_uehper bootstrap"
Push-Location $ProjectRoot
try {
    & npx --no-install puerts_uehper bootstrap
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "bootstrap exited $LASTEXITCODE (expected if Puerts backend not yet compiled)"
        Write-Warn "next steps:"
        Write-Warn "  1. Compile C++ (build UEHper + Puerts modules)"
        Write-Warn "  2. Launch UE editor, run Puerts.Gen (or npx puerts_uehper gen-typings)"
        Write-Warn "  3. Re-run: npx puerts_uehper bootstrap"
        Write-Warn "  4. npx puerts_uehper build"
    }
} finally { Pop-Location }

# --- 6. SVN detection ---
if (Test-Path (Join-Path $ProjectRoot ".svn")) {
    Write-Warn "SVN working copy detected. svn:ignore the .git under Plugins/Unreal.AIHper/:"
    Write-Warn "  svn propset svn:ignore '.git' Plugins/Unreal.AIHper"
}

# --- 7. write version record ---
$verIni = Join-Path $FrameworkRoot "UEHper/Config/UEHperFrameworkVersion.ini"
$gitVer = "unknown"
try { $gitVer = (git -C $FrameworkRoot describe --tags --always 2>$null) } catch {}
if (-not $gitVer) { $gitVer = "unknown" }
Write-Info "Version: $gitVer"
$verContent = "Version=$gitVer`r`nInstalledAt=$(Get-Date -Format o)`r`nSource=git clone"
Write-TextFile $verIni $verContent

# --- done ---
Write-Info ""
Write-Info "Initialization complete."
Write-Info "  Update framework: cd $FrameworkRoot; git pull --recurse-submodules"
Write-Info "  Push changes:     cd $FrameworkRoot; git add -A; git commit -m '...'; git push"
Write-Info ""
Write-Info "Next:"
Write-Info "  cd $ProjectRoot"
Write-Info "  npx puerts_uehper doctor    # validate layout"
Write-Info "  (compile C++ if backend missing)"
Write-Info "  npx puerts_uehper gen-typings   # after launching UE editor"
Write-Info "  npx puerts_uehper build          # compile TypeScript"
