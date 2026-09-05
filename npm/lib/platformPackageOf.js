const supportedPairs = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64", "win32-arm64"]);

export function platformPackageOf(platform, arch, musl) {
	if (!supportedPairs.has(`${platform}-${arch}`)) {
		throw new Error(`znpm has no build for ${platform}-${arch}`);
	}

	return {
		name: `@zcross/znpm-${platform}-${arch}${platform === "linux" && musl ? "-musl" : ""}`,
		binary: platform === "win32" ? "znpm.exe" : "znpm",
	};
}
