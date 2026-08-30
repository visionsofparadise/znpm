param([string]$BaseUrl = "https://github.com/visionsofparadise/znpm/releases/latest/download")

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Get-ExpectedChecksum {
	param([string]$Checksums, [string]$Asset)

	foreach ($line in $Checksums -split "`n") {
		$fields = $line.Trim() -split "\s+", 2

		if ($fields.Count -eq 2 -and $fields[1].TrimStart("*") -eq $Asset) {
			return $fields[0]
		}
	}

	throw "znpm found no SHA256SUMS entry for $Asset"
}

function Add-UserPathEntry {
	param([string]$Entry)

	$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("Environment", $true)

	if ($null -eq $key) {
		throw "znpm could not open the user PATH key"
	}

	try {
		$kind = 2
		$value = ""

		if ($key.GetValueNames() | Where-Object { $_ -ieq "Path" }) {
			$kind = [int]$key.GetValueKind("Path")
			$raw = $key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)

			if ($raw -is [string[]]) {
				$value = ($raw -join ";")
			} elseif ($null -ne $raw) {
				$value = [string]$raw
			}
		}

		$entries = @()

		if ($value -ne "") {
			$entries = $value -split ";"
		}

		if ($entries | Where-Object { $_ -ieq $Entry }) {
			return
		}

		$key.SetValue("Path", ((@($Entry) + $entries) -join ";"), [Microsoft.Win32.RegistryValueKind]$kind)
	} finally {
		$key.Close()
	}

	if (-not ("EnvironmentNative" -as [type])) {
		Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class EnvironmentNative {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
}
"@
	}

	$result = [UIntPtr]::Zero
	[EnvironmentNative]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, "Environment", 2, 5000, [ref]$result) | Out-Null
}

if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) {
	[Console]::Error.WriteLine("znpm supports Windows x64 only.")
	exit 1
}

$appDirectory = Join-Path $env:LOCALAPPDATA "znpm"
$binDirectory = Join-Path $appDirectory "bin"
$znpmAsset = "znpm-windows-x64.exe"
$npmWrapperAsset = "npm-wrapper-windows-x64.exe"
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("znpm-install-" + [Guid]::NewGuid().ToString("n"))

New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null

try {
	$checksumsPath = Join-Path $temporaryDirectory "SHA256SUMS"

	Invoke-WebRequest -Uri "$BaseUrl/SHA256SUMS" -OutFile $checksumsPath -UseBasicParsing

	$checksums = Get-Content -LiteralPath $checksumsPath -Raw

	foreach ($asset in @($znpmAsset, $npmWrapperAsset)) {
		$assetPath = Join-Path $temporaryDirectory $asset

		Invoke-WebRequest -Uri "$BaseUrl/$asset" -OutFile $assetPath -UseBasicParsing

		$expected = Get-ExpectedChecksum -Checksums $checksums -Asset $asset
		$actual = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash

		if ($actual -ine $expected) {
			throw "znpm downloaded $asset with checksum $actual, expecting $expected"
		}
	}

	New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
	Move-Item -LiteralPath (Join-Path $temporaryDirectory $znpmAsset) -Destination (Join-Path $binDirectory "znpm.exe") -Force
	Move-Item -LiteralPath (Join-Path $temporaryDirectory $npmWrapperAsset) -Destination (Join-Path $appDirectory "npm-wrapper.exe") -Force
} finally {
	Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

Add-UserPathEntry -Entry $binDirectory

$statePath = Join-Path $appDirectory "state.json"

if (Test-Path -LiteralPath $statePath) {
	$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json

	if ($state.enabled -eq $true) {
		& (Join-Path $binDirectory "znpm.exe") place-shim
	}
}

Write-Output "znpm installed. Open a new terminal and run: znpm enable"
