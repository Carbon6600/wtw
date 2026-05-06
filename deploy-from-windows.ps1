# Запуск з каталогу проєкту: .\deploy-from-windows.ps1
# Копіює файли на Proxmox-VM і перезбирає контейнер (видно в Portainer).
$ErrorActionPreference = "Stop"
$RemoteHost = "Proxmox-VM"
$RemotePath = "/srv/projects/w2w"
$here = $PSScriptRoot

ssh -o BatchMode=yes $RemoteHost "mkdir -p $RemotePath"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

scp -o BatchMode=yes Dockerfile docker-compose.yml index.html .dockerignore deploy-from-windows.ps1 "${RemoteHost}:${RemotePath}/"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

scp -o BatchMode=yes -r api "${RemoteHost}:${RemotePath}/"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

ssh -o BatchMode=yes $RemoteHost "cd $RemotePath && docker compose up -d --build"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Готово: відкрий http://<IP_сервера>:8080 і перевір у Portainer стек проєкту w2w."
