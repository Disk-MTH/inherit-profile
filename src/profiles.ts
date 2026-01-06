import * as vscode from "vscode";
import { syncExtensions } from "./lib/extensions.js";
import { Logger } from "./lib/logger.js";
import { getCurrentProfileName } from "./lib/profileDiscovery.js";
import { Reporter } from "./lib/reporter.js";
import { syncSettings } from "./lib/settings.js";

/**
 * Updates the inherited settings for the current profile.
 * @param context Extension context.
 */
export async function updateCurrentProfileInheritance(
	context: vscode.ExtensionContext,
): Promise<void> {
	Logger.initialize(context);
	Logger.info("--------------- START ---------------");

	const config = vscode.workspace.getConfiguration("inheritProfile");
	const parents = config.get<string[]>("parents", []);

	if (parents.length === 0) {
		Logger.info(
			"No parent profiles configured. Skipping inheritance update",
			"Main",
		);
		Logger.info("--------------- END ---------------");
		return;
	}

	const currentProfileName = await getCurrentProfileName(context);

	Reporter.initialize(currentProfileName, parents);
	Logger.info(
		`Syncing profile '${currentProfileName}' from parents: ${parents.join(", ")}`,
		"Main",
	);

	// Sync extensions
	await syncExtensions(context);

	// Sync settings
	await syncSettings(context);

	Logger.info("Profile inheritance update completed", "Main");
	Logger.info("--------------- END ---------------");

	await Reporter.showSummary(context);
}
