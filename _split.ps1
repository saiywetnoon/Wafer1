# Daily Crispy Roll Ledger — split single-file HTML app into modular files
# Preserves the original file; writes index.html + css/styles.css + js/*.js

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'daily-ledger-1.1.html'

# Read as UTF-8 (file contains non-ASCII chars)
$text = [System.IO.File]::ReadAllText($src, [System.Text.Encoding]::UTF8)
$nl = if ($text.Contains("`r`n")) { "`r`n" } elseif ($text.Contains("`n")) { "`n" } else { "`r`n" }
$lines = $text -split [regex]::Escape($nl)

function Write-Segment([string]$outFile, [int]$startLine, [int]$endLine) {
    $idx = $startLine - 1
    $count = $endLine - $startLine + 1
    $seg = $lines[$idx..($idx + $count - 1)]
    $full = ($seg -join $nl) + $nl
    $dir = Split-Path $outFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    [System.IO.File]::WriteAllText($outFile, $full, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output ("Wrote {0}  (lines {1}-{2}, {3} lines)" -f $outFile, $startLine, $endLine, $seg.Count)
}

# ---------- CSS ----------
Write-Segment (Join-Path $root 'css\styles.css') 26 47

# ---------- JS modules (1-based inclusive line ranges from the original) ----------
$jsSegs = [ordered]@{
    'config.js'        = @(597, 648)
    'storage.js'       = @(649, 746)
    'google.js'        = @(747, 921)
    'helpers.js'       = @(922, 1021)
    'pricing.js'       = @(1022, 1157)
    'usage.js'         = @(1158, 1276)
    'ledger.js'        = @(1277, 1403)
    'dashboard.js'     = @(1404, 1535)
    'calendar.js'      = @(1536, 1667)
    'csv.js'           = @(1668, 1688)
    'sync-ui.js'       = @(1689, 1834)
    'sample-data.js'   = @(1835, 1912)
    'inventory.js'     = @(1913, 1981)
    'customers.js'     = @(1982, 2060)
    'tools.js'         = @(2061, 2242)
    'init.js'          = @(2243, 2449)
}
$jsDir = Join-Path $root 'js'
foreach ($k in $jsSegs.Keys) {
    $r = $jsSegs[$k]
    Write-Segment (Join-Path $jsDir $k) $r[0] $r[1]
}

# ---------- index.html ----------
$head  = ($lines[0..23] -join $nl)           # through tailwind.config </script> (lines 1-24)
$link  = '<link rel="stylesheet" href="css/styles.css">'
$body  = ($lines[48..594] -join $nl)         # </head> + full body markup (lines 49-595)
$tail  = ($lines[2450..2451] -join $nl)      # </body> + </html> (lines 2451-2452)

$scriptTags = ($jsSegs.Keys | ForEach-Object { '    <script src="js/' + $_ + '"></script>' }) -join $nl

$html = ($head, $link, $body, $scriptTags, $tail) -join $nl + $nl
[System.IO.File]::WriteAllText((Join-Path $root 'index.html'), $html, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('Wrote {0}  ({1} chars)' -f (Join-Path $root 'index.html'), $html.Length)

Write-Output 'SPLIT COMPLETE'
