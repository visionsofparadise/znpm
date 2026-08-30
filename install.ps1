param([string]$BaseUrl = "https://github.com/visionsofparadise/znpm/releases/latest/download")

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Get-InstallTarget {
	$architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture

	if ($architecture -eq [Runtime.InteropServices.Architecture]::X64) {
		$arch = "x64"
	} elseif ($architecture -eq [Runtime.InteropServices.Architecture]::Arm64) {
		$arch = "arm64"
	} else {
		throw "znpm has no build for $architecture"
	}

	if ($IsLinux) {
		return "linux-$arch"
	}

	if ($IsMacOS) {
		return "darwin-$arch"
	}

	return "windows-$arch"
}

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

function Install-PosixZnpmLink {
	param([string]$ZnpmPath)

	$linkPath = "/usr/local/bin/znpm"

	& sudo mkdir -p /usr/local/bin

	if (Test-Path -LiteralPath $linkPath) {
		$existing = Get-Item -LiteralPath $linkPath

		if ($existing.LinkType -ne "SymbolicLink") {
			throw "znpm found $linkPath that it did not create"
		}

		& sudo rm -f $linkPath
	}

	& sudo ln -s $ZnpmPath $linkPath
}

Write-Output "installing..."

$target = Get-InstallTarget
$windows = $target.StartsWith("windows-")
$exe = if ($windows) { ".exe" } else { "" }

if ($windows) {
	$localAppData = $env:LOCALAPPDATA

	if ([string]::IsNullOrEmpty($localAppData)) {
		$localAppData = Join-Path $HOME "AppData\Local"
	}

	$appDirectory = Join-Path $localAppData "znpm"
} else {
	if ([string]::IsNullOrEmpty($HOME)) {
		throw "znpm requires HOME"
	}

	$appDirectory = Join-Path $HOME ".local/share/znpm"
}

$binDirectory = Join-Path $appDirectory "bin"
$shimDirectory = Join-Path $appDirectory "shim"
$znpmAsset = "znpm-$target$exe"
$npmWrapperAsset = "npm-wrapper-$target$exe"
$znpmPath = Join-Path $binDirectory "znpm$exe"
$npmWrapperPath = Join-Path $appDirectory "npm-wrapper$exe"
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
	Move-Item -LiteralPath (Join-Path $temporaryDirectory $npmWrapperAsset) -Destination $npmWrapperPath -Force
	Move-Item -LiteralPath (Join-Path $temporaryDirectory $znpmAsset) -Destination $znpmPath -Force

	if (-not $windows) {
		& chmod +x $npmWrapperPath
		& chmod +x $znpmPath
	}
} finally {
	Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

if ($windows) {
	Add-UserPathEntry -Entry $binDirectory
} else {
	Install-PosixZnpmLink -ZnpmPath $znpmPath
}

Write-Output "installed"

& $znpmPath enable

if ($LASTEXITCODE -ne 0) {
	throw "znpm enable exited with $LASTEXITCODE"
}

if ($windows) {
	$env:Path = "$shimDirectory;$binDirectory;$env:Path"
} else {
	$env:PATH = "/usr/local/bin:$env:PATH"
}
