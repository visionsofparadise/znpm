import { join } from "node:path";

export function storeControllerOptionsOf(storeDirectory: string): {
	storeDir: string;
	cacheDir: string;
	rawConfig: Record<string, string>;
	registries: { default: string };
	packageImportMethod: "hardlink";
	verifyStoreIntegrity: true;
	virtualStoreDirMaxLength: number;
} {
	return {
		storeDir: storeDirectory,
		cacheDir: join(storeDirectory, "..", "cache"),
		rawConfig: {},
		registries: { default: "https://registry.npmjs.org/" },
		packageImportMethod: "hardlink",
		verifyStoreIntegrity: true,
		virtualStoreDirMaxLength: 120,
	};
}
