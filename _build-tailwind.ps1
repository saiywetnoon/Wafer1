# Builds css/tailwind.css from css/tailwind-input.css + tailwind.config.js
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
npx -y tailwindcss@3.4.17 -i css/tailwind-input.css -o css/tailwind.css *> 'tailwind-build.log'
Write-Output 'DONE' >> 'tailwind-build.log'