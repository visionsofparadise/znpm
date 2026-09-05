param(
	[string]$BaseUrl = $(
		if ($env:ZNPM_BASE_URL) { $env:ZNPM_BASE_URL }
		else { "https://github.com/visionsofparadise/znpm/releases/latest/download" }
	)
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
	param([string]$Message)

	[Console]::Error.WriteLine($Message)
}

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
		$libc = ""

		if (Get-ChildItem -Path "/lib" -Filter "ld-musl-*" -File -ErrorAction SilentlyContinue) {
			$libc = "-musl"
		}

		return "linux-$arch$libc"
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

function Get-PosixSingleQuote {
	param([string]$Value)

	return "'" + $Value.Replace("'", "'\''") + "'"
}

function Get-PosixEnvScript {
	param([string]$AppDirectory)

	$body = @'
case ":$PATH:" in
	*":$znpm_home/npm-wrapper:"*) ;;
	*) export PATH="$znpm_home/npm-wrapper:$znpm_home/bin:$PATH" ;;
esac
unset znpm_home
'@

	return "znpm_home=" + (Get-PosixSingleQuote -Value $AppDirectory) + "`n" + ($body -replace "`r`n", "`n") + "`n"
}

function Get-PosixFishEnvScript {
	param([string]$AppDirectory)

	$body = @'
if not contains "$znpm_home/npm-wrapper" $PATH
	set -gx PATH "$znpm_home/npm-wrapper" "$znpm_home/bin" $PATH
end
'@

	return "set -l znpm_home " + (Get-PosixSingleQuote -Value $AppDirectory) + "`n" + ($body -replace "`r`n", "`n") + "`n"
}

function Get-StartupSourceLine {
	param([string]$AppDirectory)

	return ". " + (Get-PosixSingleQuote -Value (Join-Path $AppDirectory "env"))
}

function Add-StartupLine {
	param([string]$Path, [string]$Line, [bool]$CreateIfAbsent)

	$present = Test-Path -LiteralPath $Path

	if (-not $present -and -not $CreateIfAbsent) {
		return
	}

	$content = if ($present) { [IO.File]::ReadAllText($Path) } else { "" }

	foreach ($existing in ($content -split "`n")) {
		if (($existing -replace "`r$", "") -eq $Line) {
			return
		}
	}

	$separator = if ($content -ne "" -and -not $content.EndsWith("`n")) { "`n" } else { "" }

	[IO.File]::WriteAllText($Path, $content + $separator + $Line + "`n")
}

function Install-PosixExposure {
	param([string]$AppDirectory)

	[IO.File]::WriteAllText((Join-Path $AppDirectory "env"), (Get-PosixEnvScript -AppDirectory $AppDirectory))
	[IO.File]::WriteAllText((Join-Path $AppDirectory "env.fish"), (Get-PosixFishEnvScript -AppDirectory $AppDirectory))

	$line = Get-StartupSourceLine -AppDirectory $AppDirectory

	Add-StartupLine -Path (Join-Path $HOME ".profile") -Line $line -CreateIfAbsent $true
	Add-StartupLine -Path (Join-Path $HOME ".bashrc") -Line $line -CreateIfAbsent $true
	Add-StartupLine -Path (Join-Path $HOME ".zshrc") -Line $line -CreateIfAbsent $true
	Add-StartupLine -Path (Join-Path $HOME ".bash_profile") -Line $line -CreateIfAbsent $false
	Add-StartupLine -Path (Join-Path $HOME ".zprofile") -Line $line -CreateIfAbsent $false

	$fishDirectory = Join-Path (Join-Path $HOME ".config") "fish"

	if (-not (Test-Path -LiteralPath $fishDirectory)) {
		return
	}

	$fishConfigurationDirectory = Join-Path $fishDirectory "conf.d"

	New-Item -ItemType Directory -Path $fishConfigurationDirectory -Force | Out-Null
	[IO.File]::WriteAllText(
		(Join-Path $fishConfigurationDirectory "znpm.fish"),
		(Get-PosixFishEnvScript -AppDirectory $AppDirectory)
	)
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

Write-Step "installing..."

$target = Get-InstallTarget
$windows = $target.StartsWith("windows-")
$exe = if ($windows) { ".exe" } else { "" }

if (-not [string]::IsNullOrEmpty($env:ZNPM_HOME)) {
	$appDirectory = [IO.Path]::GetFullPath($env:ZNPM_HOME)
} elseif ($windows) {
	$localAppData = $env:LOCALAPPDATA

	if ([string]::IsNullOrEmpty($localAppData)) {
		$localAppData = Join-Path $HOME "AppData\Local"
	}

	$appDirectory = Join-Path $localAppData "znpm"
} elseif (-not [string]::IsNullOrEmpty($env:XDG_DATA_HOME)) {
	$appDirectory = Join-Path $env:XDG_DATA_HOME "znpm"
} elseif (-not [string]::IsNullOrEmpty($HOME)) {
	$appDirectory = Join-Path $HOME ".local/share/znpm"
} else {
	throw "znpm requires ZNPM_HOME, XDG_DATA_HOME, or HOME"
}

$binDirectory = Join-Path $appDirectory "bin"
$npmWrapperDirectory = Join-Path $appDirectory "npm-wrapper"
$znpmAsset = "znpm-$target$exe"
$npmWrapperAsset = "npm-wrapper-$target$exe"
$znpmPath = Join-Path $binDirectory "znpm$exe"
$npmWrapperPath = Join-Path $npmWrapperDirectory "npm$exe"
$temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("znpm-install-" + [Guid]::NewGuid().ToString("n"))
$distDirectory = $env:ZNPM_DIST

Write-Step "installing $target into $appDirectory"

New-Item -ItemType Directory -Path $binDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $npmWrapperDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $temporaryDirectory -Force | Out-Null

try {
	if (-not [string]::IsNullOrEmpty($distDirectory)) {
		$distDirectory = [IO.Path]::GetFullPath($distDirectory)
		Write-Step "using local dist $distDirectory"

		$localZnpm = Join-Path $distDirectory $znpmAsset
		$localWrapper = Join-Path $distDirectory $npmWrapperAsset

		if (-not (Test-Path -LiteralPath $localZnpm)) {
			throw "znpm found no $znpmAsset in $distDirectory"
		}

		if (-not (Test-Path -LiteralPath $localWrapper)) {
			throw "znpm found no $npmWrapperAsset in $distDirectory"
		}

		Write-Step "placing $npmWrapperPath"
		Copy-Item -LiteralPath $localWrapper -Destination $npmWrapperPath -Force
		Write-Step "placing $znpmPath"
		Copy-Item -LiteralPath $localZnpm -Destination $znpmPath -Force
	} else {
		$checksumsPath = Join-Path $temporaryDirectory "SHA256SUMS"

		Write-Step "downloading SHA256SUMS"
		Invoke-WebRequest -Uri "$BaseUrl/SHA256SUMS" -OutFile $checksumsPath -UseBasicParsing

		$checksums = Get-Content -LiteralPath $checksumsPath -Raw

		foreach ($asset in @($znpmAsset, $npmWrapperAsset)) {
			$assetPath = Join-Path $temporaryDirectory $asset

			Write-Step "downloading $asset"
			Invoke-WebRequest -Uri "$BaseUrl/$asset" -OutFile $assetPath -UseBasicParsing

			Write-Step "verifying $asset"
			$expected = Get-ExpectedChecksum -Checksums $checksums -Asset $asset
			$actual = (Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash

			if ($actual -ine $expected) {
				throw "znpm downloaded $asset with checksum $actual, expecting $expected"
			}
		}

		Write-Step "placing $npmWrapperPath"
		Move-Item -LiteralPath (Join-Path $temporaryDirectory $npmWrapperAsset) -Destination $npmWrapperPath -Force
		Write-Step "placing $znpmPath"
		Move-Item -LiteralPath (Join-Path $temporaryDirectory $znpmAsset) -Destination $znpmPath -Force
	}

	if (-not $windows) {
		& chmod +x $npmWrapperPath
		& chmod +x $znpmPath
	}
} finally {
	Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}

if ($windows) {
	Write-Step "prepending $binDirectory to the user PATH"
	Add-UserPathEntry -Entry $binDirectory
} else {
	Write-Step "writing $appDirectory/env and the shell startup lines"
	Install-PosixExposure -AppDirectory $appDirectory
}

Write-Step "installed"

Write-Step "prepending $npmWrapperDirectory and $binDirectory to this process PATH"
$env:PATH = $npmWrapperDirectory + [IO.Path]::PathSeparator + $binDirectory + [IO.Path]::PathSeparator + $env:PATH

if ($windows -and (Test-Path Alias:npm)) {
	Remove-Item Alias:npm -Force
}

Write-Step "run: znpm enable"
