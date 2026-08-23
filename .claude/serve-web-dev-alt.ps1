$env:Path = "C:\Program Files\nodejs;" + $env:Path
$root = (Resolve-Path "$PSScriptRoot\..\web").Path
Set-Location $root
npm run dev -- --port 5175 --strictPort
