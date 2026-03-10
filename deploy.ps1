param([string]$mensaje = "update: code + sync gifts database")

$RENDER_URL = "https://paises-race-server.onrender.com"
$DB_PATH = Join-Path $PSScriptRoot "gifts\gifts_database.json"

Write-Host "DEPLOY PAISES RACE - Con respaldo de regalos" -ForegroundColor Cyan

# 1. Descargar gifts_database.json del servidor LIVE
Write-Host "Descargando base de datos de regalos desde Render..." -ForegroundColor Yellow
$exportUrl = $RENDER_URL + "/api/gifts/export"

try {
    Invoke-WebRequest -Uri $exportUrl -OutFile $DB_PATH -TimeoutSec 30 -ErrorAction Stop
    Write-Host "Regalos descargados y guardados en gifts_database.json" -ForegroundColor Green
} catch {
    Write-Host "No se pudo conectar a Render: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Continuando con archivo local existente..." -ForegroundColor DarkGray
}

# 2. Git add, commit, push
Write-Host "Enviando cambios a Git..." -ForegroundColor Yellow
git add -A
git status --porcelain | Out-String | Write-Host

$cambios = git status --porcelain
if ($cambios) {
    git commit -m $mensaje
    Write-Host "Commit creado: $mensaje" -ForegroundColor Green
} else {
    Write-Host "No hay cambios para commitear." -ForegroundColor DarkGray
}

git push
Write-Host "Deploy completado!" -ForegroundColor Green
