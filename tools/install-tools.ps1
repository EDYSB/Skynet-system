# Portable-first installer. Everything lands in tools\, no system install by default.
#
#   powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1 -ListOnly
#   powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1
#   powershell -ExecutionPolicy Bypass -File tools\install-tools.ps1 -WithInstallers   (admin required)
[CmdletBinding()]
param(
  [switch]$ListOnly,
  [switch]$WithInstallers,
  [string]$Only = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$binDir = Join-Path $root 'bin'
$dlDir = Join-Path $root '_dl'
$log = Join-Path $root 'install-log.txt'

function Write-Log([string]$msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line
  Add-Content -Path $log -Value $line -Encoding UTF8
}

# Portable archives: unpacked into tools\<Dir>. Verified=$true means the URL answered HEAD 200 here.
$portable = @(
  @{ Name = 'Nmap';     Dir = 'nmap';     Url = 'https://nmap.org/dist/nmap-7.92-win32.zip';   Exe = 'nmap.exe';         Verified = $true  },
  @{ Name = 'ExifTool'; Dir = 'exiftool'; Url = 'https://sourceforge.net/projects/exiftool/files/exiftool-13.59_64.zip/download'; Exe = 'exiftool.exe'; Verified = $true },
  @{ Name = 'TestDisk'; Dir = 'testdisk'; Url = 'https://www.cgsecurity.org/Download_and_donate.php/testdisk-7.3-WIP.win64.zip'; Exe = 'testdisk_win.exe'; Verified = $true }
)

# Download with curl (resume + retry), then BITS, then plain HTTP
function Get-Archive([string]$url, [string]$out) {
  $curl = 'C:\Windows\System32\curl.exe'
  if (Test-Path $curl) {
    Write-Log '  using curl (resume + retry)'
    & $curl -L --fail --retry 30 --retry-delay 2 --retry-all-errors --connect-timeout 30 `
      -C - -o $out $url 2>&1 | ForEach-Object { Write-Log ('    ' + $_) }
    if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) { return $true }
    Write-Log ("  curl exit code " + $LASTEXITCODE)
  }
  try {
    if (Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue) {
      Start-BitsTransfer -Source $url -Destination $out -TransferType Download -Priority Foreground -ErrorAction Stop
      if (Test-Path $out) { return $true }
    }
  } catch {
    Write-Log ('  BITS failed: ' + $_.Exception.Message)
  }
  try {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 900
    return $true
  } catch {
    Write-Log ('  HTTP failed: ' + $_.Exception.Message)
    return $false
  }
}

function Test-Zip([string]$path) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
    $count = $zip.Entries.Count
    $zip.Dispose()
    return $count -gt 0
  } catch {
    return $false
  }
}

# No portable build: winget package (system install, needs admin)
$installers = @(
  @{ Id = 'WiresharkFoundation.Wireshark';   Name = 'Wireshark (bundles Npcap)' },
  @{ Id = 'PortSwigger.BurpSuite.Community'; Name = 'Burp Suite Community' },
  @{ Id = 'Tenable.Nessus';                  Name = 'Tenable Nessus' },
  @{ Id = 'SleuthKit.Autopsy';               Name = 'Autopsy' },
  @{ Id = 'Giuspen.Cherrytree';              Name = 'CherryTree' },
  @{ Id = 'ffuf.ffuf';                       Name = 'ffuf' }
)

# Manual download only: no winget package and no stable portable URL
$manual = @(
  @{ Name = 'Metasploit Framework'; Url = 'https://windows.metasploit.com/metasploitframework-latest.msi' },
  @{ Name = 'Hashcat';              Url = 'https://hashcat.net/hashcat/' },
  @{ Name = 'John the Ripper';      Url = 'https://www.openwall.com/john/' },
  @{ Name = 'theHarvester';         Url = 'https://github.com/laramies/theHarvester' },
  @{ Name = 'NetExec';              Url = 'https://github.com/Pennyw0rth/NetExec' },
  @{ Name = 'Responder';            Url = 'https://github.com/lgandx/Responder' },
  @{ Name = 'Gobuster';             Url = 'https://github.com/OJ/gobuster/releases' },
  @{ Name = 'Nikto / Dirb';         Url = 'https://strawberryperl.com/ (Perl first)' },
  @{ Name = 'tcpdump / ettercap';   Url = 'use WSL: https://learn.microsoft.com/windows/wsl/' },
  @{ Name = 'Bettercap';            Url = 'https://www.bettercap.org/installation/' }
)

Write-Log '== tools/install-tools.ps1 (portable-first) =='

if ($ListOnly) {
  Write-Log 'portable -> tools\<name>\ :'
  foreach ($p in $portable) {
    $mark = if ($p.Verified) { 'verified' } else { 'unverified URL' }
    Write-Log ("  - {0,-10} {1}  [{2}]" -f $p.Name, $p.Url, $mark)
  }
  Write-Log 'winget installers (only with -WithInstallers, admin):'
  foreach ($i in $installers) { Write-Log ("  - {0}  ({1})" -f $i.Name, $i.Id) }
  Write-Log 'manual:'
  foreach ($m in $manual) { Write-Log ("  - {0}  {1}" -f $m.Name, $m.Url) }
  exit 0
}

New-Item -ItemType Directory -Force -Path $binDir, $dlDir | Out-Null

function Write-Wrapper([string]$name, [string]$relExe) {
  $cmd = Join-Path $binDir ($name + '.cmd')
  $body = "@echo off`r`nrem generated wrapper`r`nsetlocal`r`nset `"HERE=%~dp0`"`r`n`"%HERE%..\$relExe`" %*`r`n"
  Set-Content -Path $cmd -Value $body -Encoding ASCII
  Write-Log ("  wrapper: bin\{0}.cmd -> {1}" -f $name, $relExe)
}

$failed = @()
foreach ($p in $portable) {
  if ($Only -and $p.Name -ne $Only) { continue }
  $dest = Join-Path $root $p.Dir
  $zip = Join-Path $dlDir ($p.Name + '.zip')
  Write-Log ("[{0}] downloading {1}" -f $p.Name, $p.Url)
  if (-not (Get-Archive $p.Url $zip)) {
    $failed += $p.Name
    continue
  }
  $size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Log ("  got {0} MB" -f $size)
  if (-not (Test-Zip $zip)) {
    Write-Log '  archive is broken or truncated, skipped'
    $failed += $p.Name
    continue
  }
  try {
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Expand-Archive -Path $zip -DestinationPath $dest -Force
  } catch {
    Write-Log ('  extract failed: ' + $_.Exception.Message)
    $failed += $p.Name
    continue
  }
  # flatten a single top-level folder (nmap-7.92/ etc.)
  $entries = Get-ChildItem $dest
  if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) {
    $inner = $entries[0].FullName
    Get-ChildItem $inner | Move-Item -Destination $dest -Force
    Remove-Item -Recurse -Force $inner
  }
  $exe = Join-Path $dest $p.Exe
  if (Test-Path $exe) {
    Write-Wrapper $p.Name.ToLower() ($p.Dir + '\' + $p.Exe)
    Write-Log ("  ok: {0}" -f $exe)
  } else {
    Write-Log ("  extracted, but {0} not found (adjust Exe in the script)" -f $p.Exe)
    $failed += $p.Name
  }
  Remove-Item -Force $zip -ErrorAction SilentlyContinue
}

if ($WithInstallers) {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    Write-Log 'skipped winget installers: administrator required'
  } else {
    foreach ($i in $installers) {
      Write-Log ("winget install {0} ({1})" -f $i.Name, $i.Id)
      & winget install --id $i.Id --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity 2>&1 |
        ForEach-Object { Write-Log ("    " + $_) }
      if ($LASTEXITCODE -ne 0) { $failed += $i.Name }
    }
  }
}

Write-Log ''
Write-Log '===== summary ====='
if ($failed.Count) { Write-Log ("failed/skipped: " + ($failed -join ', ')) } else { Write-Log 'done' }
Write-Log 'manual:'
foreach ($m in $manual) { Write-Log ("  - {0}  {1}" -f $m.Name, $m.Url) }
Write-Log ''
Write-Log 'Add tools\bin to PATH once:  tools\env.cmd'
