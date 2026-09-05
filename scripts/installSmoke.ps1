param(
	[Parameter(Mandatory = $true)]
	[string]$Dist
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
	param([string]$Message)

	[Console]::Error.WriteLine("== $Message")
}

function Stop-Smoke {
	param([string]$Message)

	throw $Message
}

function Get-RegistryPathValue {
	param([string]$Scope)

	if ($Scope -eq "machine") {
		$root = [Microsoft.Win32.Registry]::LocalMachine
		$subKey = "SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
	} else {
		$root = [Microsoft.Win32.Registry]::CurrentUser
		$subKey = "Environment"
	}

	$key = $root.OpenSubKey($subKey, $false)

	if ($null -eq $key) {
		Stop-Smoke "installSmoke could not open the $Scope PATH key"
	}

	try {
		if (-not ($key.GetValueNames() | Where-Object { $_ -ieq "Path" })) {
			return ""
		}

		$raw = $key.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)

		if ($null -eq $raw) {
			return ""
		}

		if ($raw -is [string[]]) {
			return ($raw -join ";")
		}

		return [string]$raw
	} finally {
		$key.Close()
	}
}

function Test-PathValueUnder {
	param([string]$PathValue, [string]$Directory)

	$prefix = $Directory.TrimEnd("\").ToLowerInvariant()

	foreach ($entry in ($PathValue -split ";")) {
		$normalized = $entry.Trim().TrimEnd("\").ToLowerInvariant()

		if ($normalized -eq $prefix -or $normalized.StartsWith("$prefix\")) {
			return $true
		}
	}

	return $false
}

function Get-StateFingerprint {
	param([string]$Path)

	if (-not (Test-Path -LiteralPath $Path)) {
		return "absent"
	}

	return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Wait-AppDirectoryRemoval {
	param([string]$Path)

	$deadline = (Get-Date).AddSeconds(60)

	while ((Test-Path -LiteralPath $Path) -and (Get-Date) -lt $deadline) {
		Start-Sleep -Milliseconds 500
	}
}

$scriptDirectory = Split-Path -Parent $PSCommandPath
$distDirectory = (Resolve-Path -LiteralPath $Dist).Path
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) ("znpm-smoke-" + [Guid]::NewGuid().ToString("n"))
$fixtureDirectory = Join-Path $smokeRoot "fixture"
$appDirectory = Join-Path $smokeRoot "znpm"

$env:ZNPM_HOME = $appDirectory
$env:ZNPM_DIST = $distDirectory
$env:ZNPM_STORE_DIR = Join-Path $smokeRoot "store"
$env:PNPM_HOME = Join-Path $smokeRoot "pnpm-home"

$localZnpmDirectory = Join-Path $env:LOCALAPPDATA "znpm"
$localStatePath = Join-Path $localZnpmDirectory "state.json"
$localStateBefore = Get-StateFingerprint -Path $localStatePath

$exitCode = 0

try {
	New-Item -ItemType Directory -Path $fixtureDirectory -Force | Out-Null

	Write-Step "install"
	& (Join-Path $scriptDirectory "install.ps1")

	Write-Step "assert the installer wrote the exposure and left znpm disabled"

	if (-not (Test-PathValueUnder -PathValue (Get-RegistryPathValue -Scope "user") -Directory $appDirectory)) {
		Stop-Smoke "install.ps1 left no user PATH entry under $appDirectory"
	}

	if (Test-PathValueUnder -PathValue (Get-RegistryPathValue -Scope "machine") -Directory $appDirectory) {
		Stop-Smoke "install.ps1 left a machine PATH entry under $appDirectory, which only enable writes"
	}

	$npmVersion = (& npm -v) -join ""

	if ($LASTEXITCODE -ne 0) {
		Stop-Smoke "npm -v exited with $LASTEXITCODE after install"
	}

	if ($npmVersion -like "*(znpm *") {
		Stop-Smoke "npm -v printed $npmVersion after install, so install left znpm enabled"
	}

	$znpmCommand = Get-Command znpm -ErrorAction SilentlyContinue

	if ($null -eq $znpmCommand) {
		Stop-Smoke "znpm is not on PATH after install"
	}

	$expectedBinDirectory = Join-Path $appDirectory "bin"

	if ((Split-Path -Parent $znpmCommand.Source) -ine $expectedBinDirectory) {
		Stop-Smoke "znpm resolved to $($znpmCommand.Source) outside $expectedBinDirectory"
	}

	Write-Step "enable"
	& znpm enable

	if ($LASTEXITCODE -ne 0) {
		Stop-Smoke "znpm enable exited with $LASTEXITCODE"
	}

	$npmVersion = (& npm -v) -join ""

	if ($LASTEXITCODE -ne 0) {
		Stop-Smoke "npm -v exited with $LASTEXITCODE while enabled"
	}

	if ($npmVersion -notlike "*(znpm *") {
		Stop-Smoke "npm -v printed $npmVersion while enabled"
	}

	Write-Step "install a fixture"
	[IO.File]::WriteAllText(
		(Join-Path $fixtureDirectory "package.json"),
		'{"name":"znpm-smoke","private":true,"dependencies":{"ms":"2.1.3"}}' + "`n"
	)

	$env:npm_config_audit = "false"
	$env:npm_config_fund = "false"
	$env:npm_config_update_notifier = "false"

	Push-Location $fixtureDirectory

	try {
		& npm install

		if ($LASTEXITCODE -ne 0) {
			Stop-Smoke "npm install exited with $LASTEXITCODE"
		}
	} finally {
		Pop-Location
	}

	$manifestPath = Join-Path $fixtureDirectory "node_modules\ms\package.json"

	if (-not (Test-Path -LiteralPath $manifestPath)) {
		Stop-Smoke "npm install left no $manifestPath"
	}

	$links = @(& fsutil hardlink list $manifestPath | Where-Object { $_.Trim() -ne "" })

	if ($links.Count -le 1) {
		Stop-Smoke "expected a store-linked tree, got $($links.Count) hard link(s) for $manifestPath"
	}

	Write-Step "disable"
	& znpm disable

	if ($LASTEXITCODE -ne 0) {
		Stop-Smoke "znpm disable exited with $LASTEXITCODE"
	}

	$npmVersion = (& npm -v) -join ""

	if ($LASTEXITCODE -ne 0) {
		Stop-Smoke "npm -v exited with $LASTEXITCODE while disabled"
	}

	if ($npmVersion -like "*(znpm *") {
		Stop-Smoke "npm -v printed $npmVersion while disabled"
	}

	Write-Step "uninstall"
	& znpm uninstall

	if ($LASTEXITCODE -ne 0) {
		Stop-Smoke "znpm uninstall exited with $LASTEXITCODE"
	}

	Wait-AppDirectoryRemoval -Path $appDirectory

	if (Test-Path -LiteralPath $appDirectory) {
		Stop-Smoke "znpm uninstall left $appDirectory after 60 seconds"
	}

	if (Test-PathValueUnder -PathValue (Get-RegistryPathValue -Scope "machine") -Directory $appDirectory) {
		Stop-Smoke "znpm uninstall left a machine PATH entry under $appDirectory"
	}

	if (Test-PathValueUnder -PathValue (Get-RegistryPathValue -Scope "user") -Directory $appDirectory) {
		Stop-Smoke "znpm uninstall left a user PATH entry under $appDirectory"
	}

	$localStateAfter = Get-StateFingerprint -Path $localStatePath

	if ($localStateAfter -ne $localStateBefore) {
		Stop-Smoke "the run changed $localStatePath"
	}

	Write-Step "install smoke passed"
} catch {
	[Console]::Error.WriteLine($_.Exception.Message)
	$exitCode = 1
} finally {
	$ErrorActionPreference = "Continue"

	$znpmExecutable = Join-Path (Join-Path $appDirectory "bin") "znpm.exe"

	if (Test-Path -LiteralPath $znpmExecutable) {
		Write-Step "cleanup: znpm uninstall"

		try {
			& $znpmExecutable uninstall
		} catch {
			[Console]::Error.WriteLine("cleanup: znpm uninstall failed: $($_.Exception.Message)")
		}

		Wait-AppDirectoryRemoval -Path $appDirectory
	}

	Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue

	foreach ($scope in @("machine", "user")) {
		if (Test-PathValueUnder -PathValue (Get-RegistryPathValue -Scope $scope) -Directory $appDirectory) {
			[Console]::Error.WriteLine("cleanup: a $scope PATH entry under $appDirectory survives; remove it by hand")
		}
	}
}

exit $exitCode
