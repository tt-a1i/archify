param(
  [Parameter(Mandatory = $true)]
  [string]$NodeVersion,
  [switch]$Cleanup
)

$ErrorActionPreference = 'Stop'
$shareName = "archify-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT-node$NodeVersion"
$fixtureRoot = Join-Path $env:RUNNER_TEMP $shareName

function Remove-ArchifyWindowsPathFixtures {
  Get-SmbShare -Name $shareName -ErrorAction SilentlyContinue |
    Remove-SmbShare -Force -Confirm:$false -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $fixtureRoot) {
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
  }
}

if ($Cleanup) {
  Remove-ArchifyWindowsPathFixtures
  exit 0
}

$shareRoot = Join-Path $fixtureRoot 'share'
$caseRoot = Join-Path $fixtureRoot 'case-sensitive'
$eightDotThreeRoot = Join-Path $fixtureRoot 'controlled-eight-dot-three-root'
$eightDotThreeShortRoot = Join-Path $fixtureRoot 'ARCH8D~1'
Remove-ArchifyWindowsPathFixtures
New-Item -ItemType Directory -Path $shareRoot, $caseRoot, $eightDotThreeRoot | Out-Null

& fsutil.exe file setshortname $eightDotThreeRoot 'ARCH8D~1'
if ($LASTEXITCODE -ne 0) {
  throw "Could not assign the controlled 8.3 alias at $eightDotThreeRoot"
}
$eightDotThreeProbe = Join-Path $eightDotThreeRoot 'short-name-probe.txt'
$eightDotThreeAliasProbe = Join-Path $eightDotThreeShortRoot 'short-name-probe.txt'
[IO.File]::WriteAllText($eightDotThreeProbe, 'controlled-8dot3')
if (-not [IO.Directory]::Exists($eightDotThreeShortRoot) -or
    [IO.File]::ReadAllText($eightDotThreeAliasProbe) -ne 'controlled-8dot3') {
  throw 'The explicit 8.3 alias did not resolve to the controlled NTFS directory.'
}
[IO.File]::Delete($eightDotThreeProbe)

& fsutil.exe file setCaseSensitiveInfo $caseRoot enable
if ($LASTEXITCODE -ne 0) {
  throw "Could not enable per-directory case sensitivity at $caseRoot"
}
$upperProbe = Join-Path $caseRoot 'ArchifyCaseProbe.txt'
$lowerProbe = Join-Path $caseRoot 'archifycaseprobe.txt'
[IO.File]::WriteAllText($upperProbe, 'upper')
[IO.File]::WriteAllText($lowerProbe, 'lower')
if ([IO.File]::ReadAllText($upperProbe) -ne 'upper' -or
    [IO.File]::ReadAllText($lowerProbe) -ne 'lower') {
  throw 'The controlled NTFS directory did not preserve case-distinct files.'
}
[IO.File]::Delete($upperProbe)
[IO.File]::Delete($lowerProbe)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
New-SmbShare -Name $shareName -Path $shareRoot -Temporary -ChangeAccess $identity | Out-Null
$uncRoot = "\\localhost\$shareName"
$extendedUncRoot = "\\?\UNC\localhost\$shareName"
$uncProbe = [IO.Path]::Combine($uncRoot, 'ordinary-unc-probe.txt')
$extendedProbe = [IO.Path]::Combine($extendedUncRoot, 'extended-unc-probe.txt')
[IO.File]::WriteAllText($uncProbe, 'ordinary')
[IO.File]::WriteAllText($extendedProbe, 'extended')
if ([IO.File]::ReadAllText($uncProbe) -ne 'ordinary' -or
    [IO.File]::ReadAllText($extendedProbe) -ne 'extended') {
  throw 'The controlled SMB share did not support ordinary and extended UNC access.'
}
[IO.File]::Delete($uncProbe)
[IO.File]::Delete($extendedProbe)

Add-Content -LiteralPath $env:GITHUB_ENV -Value "ARCHIFY_WINDOWS_CASE_SENSITIVE_ROOT=$caseRoot"
Add-Content -LiteralPath $env:GITHUB_ENV -Value "ARCHIFY_WINDOWS_UNC_ROOT=$uncRoot"
Add-Content -LiteralPath $env:GITHUB_ENV -Value "ARCHIFY_WINDOWS_EXTENDED_UNC_ROOT=$extendedUncRoot"
Add-Content -LiteralPath $env:GITHUB_ENV -Value "ARCHIFY_WINDOWS_8DOT3_ROOT=$eightDotThreeRoot"
Add-Content -LiteralPath $env:GITHUB_ENV -Value "ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT=$eightDotThreeShortRoot"
