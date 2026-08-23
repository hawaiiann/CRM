# Отдаёт СОБРАННОЕ приложение с тем же base /CRM/, что и GitHub Pages.
# Нужен для проверки прод-сборки: статический serve.ps1 отдаёт корень репозитория
# по /, а index.html ссылается на /CRM/assets/... — и всё падает в 404.
$env:Path = "C:\Program Files\nodejs;" + $env:Path
$root = (Resolve-Path "$PSScriptRoot\..\web").Path
Set-Location $root
npx vite preview --port 4174 --strictPort --outDir ..
