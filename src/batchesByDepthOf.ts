export function batchesByDepthOf<LocatedPackage extends { location: string }>(
	packages: Array<LocatedPackage>,
): Map<number, Array<LocatedPackage>> {
	const batches = new Map<number, Array<LocatedPackage>>();

	for (const locatedPackage of packages) {
		const depth = (locatedPackage.location.match(/(^|\/)node_modules(\/|$)/g) ?? []).length;
		const batch = batches.get(depth);

		if (batch === undefined) {
			batches.set(depth, [locatedPackage]);
		} else {
			batch.push(locatedPackage);
		}
	}

	return batches;
}
