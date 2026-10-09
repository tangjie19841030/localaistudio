# build-portable.ps1 — 打包 Local AI UI Studio 便携试用包
# 产出: dist-portable/LocalAIUIStudio-portable-<date>.zip
#
# 安全铁律：
#   - 绝不打包 data/settings.json（含 API key）
#   - 绝不打包 data/projects（用户项目数据）
#   - 包内 settings.json 由模板生成（provider=mock，零密钥零网络）
#   - 打包后自动扫描泄漏，命中即失败
#
# 结构（pnpm deploy --legacy 产出自包含应用，无符号链接、无 robocopy）：
#   LocalAIUIStudio/
#     app/server/        自包含服务端（源码 + 内联依赖）
#     app/workbench/     自包含前端（源码 + 内联依赖 + vite）
#     runtime/node.exe   自带 node
#     runtime/pnpm/      自带 pnpm（预览项目装依赖用）
#     data/              干净数据目录
#     START-PORTABLE.bat  one-click launcher (ASCII name)
#
# 用法: powershell -ExecutionPolicy Bypass -File scripts/build-portable.ps1

$ErrorActionPreference = "Stop"
$repo = Resolve-Path "$PSScriptRoot/.."
$date = Get-Date -Format "yyyyMMdd"
$stage = Join-Path $repo "dist-portable/stage"
$zipName = "LocalAIUIStudio-portable-$date.zip"
$zipPath = Join-Path $repo "dist-portable/$zipName"
$pnpmHome = $env:STUDIO_PNPM_HOME
if (-not $pnpmHome) { throw "STUDIO_PNPM_HOME is required" }
$env:PATH = "$pnpmHome;$env:PATH"

Write-Host "== 1. 清理暂存 =="
if (Test-Path (Join-Path $repo "dist-portable")) {
  Remove-Item (Join-Path $repo "dist-portable") -Recurse -Force
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Write-Host "== 2. pnpm deploy 产出自包含 server/workbench =="
$appDir = Join-Path $stage "app"
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
pnpm --filter "@studio/server" deploy --legacy "$appDir/server" --prod --config.proxy= --config.https-proxy=
if ($LASTEXITCODE -ne 0) { throw "server deploy 失败" }
# workbench WITHOUT --prod: vite is a devDependency but the portable package
# serves the editor through vite dev, so dev deps must ship.
pnpm --filter "@studio/workbench" deploy --legacy "$appDir/workbench" --config.proxy= --config.https-proxy=
if ($LASTEXITCODE -ne 0) { throw "workbench deploy 失败" }

Write-Host "== 3. git 归档补充 docs =="
$archiveTmp = Join-Path $env:TEMP "portable-src.zip"
git -C $repo archive --format=zip --output="$archiveTmp" HEAD docs 2>$null
if ($LASTEXITCODE -eq 0) {
  Expand-Archive -Path $archiveTmp -DestinationPath (Join-Path $stage "app") -Force
} else {
  Write-Host "  (docs not in HEAD yet - skipped)"
}
Remove-Item $archiveTmp -Force -ErrorAction SilentlyContinue

Write-Host "== 4. 自带运行时：node.exe + pnpm =="
$runtime = Join-Path $stage "runtime"
New-Item -ItemType Directory -Path "$runtime/pnpm" -Force | Out-Null
$nodeSrc = $env:STUDIO_NODE_EXE
if (-not $nodeSrc) { throw "STUDIO_NODE_EXE is required" }
if (-not (Test-Path $nodeSrc)) { throw "找不到 node.exe: $nodeSrc" }
Copy-Item $nodeSrc "$runtime/node.exe"
Copy-Item (Join-Path $pnpmHome "package") "$runtime/pnpm/package" -Recurse

Write-Host "== 5. 干净数据目录（无密钥/无用户项目）=="
$dataDir = Join-Path $appDir "data"
New-Item -ItemType Directory -Path "$dataDir/projects" -Force | Out-Null
if (Test-Path (Join-Path $repo "data/templates")) {
  Copy-Item (Join-Path $repo "data/templates") "$dataDir/templates" -Recurse
}
$settings = @{
  provider    = "mock"
  openai      = @{ baseUrl = "https://api.openai.com/v1"; apiKey = ""; model = "" }
  ollama      = @{ baseUrl = "http://127.0.0.1:11434"; model = "" }
  temperature = 0.2
} | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText((Join-Path $dataDir "settings.json"), $settings,
  [System.Text.UTF8Encoding]::new($false))

Write-Host "== 6. 启动器与说明 =="
Copy-Item (Join-Path $repo "scripts/portable-start.bat") $stage -Force
Copy-Item (Join-Path $repo "scripts/portable-readme.txt") $stage -Force
# cmd requires CRLF line endings on BAT files - LF-only breaks %~dp0 expansion.
$batRaw = (Get-Content (Join-Path $stage "portable-start.bat") -Raw)
$bat = $batRaw -replace "`r?`n", "`r`n"
[System.IO.File]::WriteAllText((Join-Path $stage "START-PORTABLE.bat"), $bat,
  [System.Text.Encoding]::ASCII)
Remove-Item (Join-Path $stage "portable-start.bat")

Write-Host "== 7. 泄漏扫描（命中即失败）=="
# 7a. 任何 settings.json 不得含非空 apiKey
$leaks = Get-ChildItem $stage -Recurse -File -Filter "settings.json" |
  Where-Object { (Get-Content $_.FullName -Raw) -match '"apiKey"\s*:\s*"[^"]+"' }
if ($leaks) { throw ("疑似密钥泄漏: " + ($leaks.FullName -join "; ")) }
# 7b. 不得有用户项目（data/projects 必须为空目录）
$proj = Join-Path $appDir "data/projects"
if (-not (Test-Path $proj)) { throw "data/projects 缺失" }
if ((Get-ChildItem $proj -Force).Count -gt 0) { throw "data/projects 必须为空" }
# 7c. 自有源码不得含用户模型端点痕迹（排除第三方 node_modules 的文档示例）
$scan = Get-ChildItem "$appDir" -Recurse -File -Include "*.ts","*.tsx","*.json","*.html" |
  Where-Object { $_.FullName -notmatch "node_modules" } |
  Select-String -Pattern 'ark-code|volces\.com/api/coding|glm-5' -List
if ($scan) { throw ("发现用户模型配置痕迹: " + (($scan.Path | Select-Object -First 3 -Unique) -join "; ")) }

Write-Host "== 8. 打 zip（bsdtar：保留符号链接；Compress-Archive 会静默丢弃它们）=="
New-Item -ItemType Directory -Path (Split-Path $zipPath) -Force | Out-Null
# Absolute path: Git Bash's GNU tar shadows bsdtar on PATH and cannot write zip.
& "C:\Windows\System32\tar.exe" -a -c -f "$zipPath" -C $stage .
if ($LASTEXITCODE -ne 0) { throw "tar 打包失败 (code $LASTEXITCODE)" }
$size = [int]((Get-Item $zipPath).Length / 1MB)
Write-Host "DONE: $zipPath ($size MB)"
