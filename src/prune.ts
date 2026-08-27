import { createNewStoreController } from "@pnpm/store-connection-manager";
import { finishWorkers, storeControllerOptionsOf } from "./convert";

export async function pruneStoreDirectories(storeDirectories: Array<string>): Promise<void> {
	for (const storeDirectory of storeDirectories) {
		const { ctrl: storeController } = await createNewStoreController(storeControllerOptionsOf(storeDirectory));

		await storeController.prune();
		await storeController.close();
		await finishWorkers();
	}
}
