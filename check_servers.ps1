# Script para revisar configuracion de ambos servidores
# Usar con: powershell -ExecutionPolicy Bypass -File check_servers.ps1

$servers = @(
    @{ ip = "95.111.242.123"; pass = "Tache2025*"; name = "Servidor 95" },
    @{ ip = "157.173.116.140"; pass = "iM4x63oUtMhqf"; name = "Servidor 157" }
)

$cmds = @"
echo '========== SITES-ENABLED ==========' && ls -la /etc/nginx/sites-enabled/ 2>/dev/null; echo '========== VAR WWW ==========' && ls -la /var/www/ 2>/dev/null; echo '========== TODAS LAS CONFIGS NGINX ==========' && for f in /etc/nginx/sites-enabled/*; do echo "--- ARCHIVO: \$f ---"; cat "\$f" 2>/dev/null; done; echo '========== PM2 LISTA ==========' && pm2 list 2>/dev/null; echo '========== PUERTOS ACTIVOS ==========' && ss -tlnp 2>/dev/null | grep LISTEN
"@

foreach ($s in $servers) {
    Write-Host "`n`n=============================" -ForegroundColor Cyan
    Write-Host "=== $($s.name) ($($s.ip)) ===" -ForegroundColor Cyan
    Write-Host "=============================`n" -ForegroundColor Cyan
    
    # Usar plink si existe, sino ssh
    $plink = "C:\Program Files\PuTTY\plink.exe"
    if (Test-Path $plink) {
        echo $s.pass | & $plink -ssh -l root -pw $s.pass $s.ip $cmds
    } else {
        # SSH nativo - necesita SSH_ASKPASS o esperamos la salida
        $env:SSHPASS = $s.pass
        ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=no "root@$($s.ip)" $cmds
    }
}
