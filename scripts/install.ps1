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

function Get-NormalizedPosixPath {
	param([string]$Value)

	$rooted = $Value.StartsWith("/")
	$segments = New-Object System.Collections.Generic.List[string]

	foreach ($segment in ($Value -split "/")) {
		if ($segment -eq "" -or $segment -eq ".") {
			continue
		}

		if ($segment -eq "..") {
			if ($segments.Count -gt 0 -and $segments[$segments.Count - 1] -ne "..") {
				$segments.RemoveAt($segments.Count - 1)
				continue
			}

			if ($rooted) {
				continue
			}
		}

		$segments.Add($segment)
	}

	$joined = [string]::Join("/", $segments)

	if ($rooted) {
		return "/" + $joined
	}

	if ($joined -eq "") {
		return "."
	}

	return $joined
}

Write-Step "installing..."

$target = Get-InstallTarget
$windows = $target.StartsWith("windows-")
$exe = if ($windows) { ".exe" } else { "" }

$homeDirectory = if (-not [string]::IsNullOrEmpty($env:HOME)) { $env:HOME } else { $HOME }

if (-not [string]::IsNullOrEmpty($env:ZNPM_HOME)) {
	$appDirectory = [IO.Path]::GetFullPath($env:ZNPM_HOME)

	if (-not $windows) {
		$appDirectory = Get-NormalizedPosixPath -Value $appDirectory
	}
} elseif ($windows) {
	$localAppData = $env:LOCALAPPDATA

	if ([string]::IsNullOrEmpty($localAppData)) {
		$localAppData = Join-Path $homeDirectory "AppData\Local"
	}

	$appDirectory = Join-Path $localAppData "znpm"
} elseif (-not [string]::IsNullOrEmpty($env:XDG_DATA_HOME)) {
	$appDirectory = Get-NormalizedPosixPath -Value ($env:XDG_DATA_HOME + "/znpm")
} elseif (-not [string]::IsNullOrEmpty($homeDirectory)) {
	$appDirectory = Get-NormalizedPosixPath -Value ($homeDirectory + "/.local/share/znpm")
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

Write-Step "installed"

if ($windows -and (Test-Path Alias:npm)) {
	Remove-Item Alias:npm -Force
}

& $znpmPath enable --shell powershell | Invoke-Expression

if ($LASTEXITCODE -ne 0) {
	throw "znpm enable exited with $LASTEXITCODE"
}
