# NOMA — сборка и запуск одной командой (Windows PowerShell)
#   .\start.ps1            — собрать фронтенд и запустить всё на http://localhost:8000
#   .\start.ps1 -Demo      — то же + заполнить базу демо-данными
#   .\start.ps1 -Dev       — режим разработки: backend с автоперезагрузкой + Vite на :5173
param([switch]$Dev, [switch]$Demo)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "→ Создаю виртуальное окружение Python" -ForegroundColor Cyan
    python -m venv (Join-Path $root "backend\.venv")
}
Write-Host "→ Зависимости backend" -ForegroundColor Cyan
& $py -m pip install -q -r (Join-Path $root "backend\requirements.txt")

Push-Location (Join-Path $root "frontend")
if (-not (Test-Path "node_modules")) {
    Write-Host "→ Зависимости frontend (npm install)" -ForegroundColor Cyan
    npm install
}
if (-not $Dev) {
    Write-Host "→ Сборка frontend" -ForegroundColor Cyan
    npm run build
}
Pop-Location

if ($Demo) {
    Push-Location (Join-Path $root "backend")
    & $py -X utf8 seed_demo.py
    Pop-Location
}

if ($Dev) {
    Write-Host "→ Backend: http://localhost:8000   Frontend: http://localhost:5173" -ForegroundColor Green
    Start-Process -FilePath $py -ArgumentList "-m", "uvicorn", "app.main:app", "--app-dir", (Join-Path $root "backend"), "--reload", "--port", "8000"
    Push-Location (Join-Path $root "frontend")
    npm run dev
    Pop-Location
} else {
    Write-Host "→ NOMA запущен: http://localhost:8000" -ForegroundColor Green
    & $py -m uvicorn app.main:app --app-dir (Join-Path $root "backend") --host 0.0.0.0 --port 8000
}
