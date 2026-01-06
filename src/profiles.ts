import * as path from "node:path";
import * as vscode from "vscode";
import { syncExtensions } from "./lib/extensions.js";
import { syncKeybindings } from "./lib/keybindings.js";
import { Logger } from "./lib/logger.js";
import { syncMcp } from "./lib/mcp.js";
import {
	getCurrentProfileName,
	getGlobalStoragePath,
	getProfileMap,
} from "./lib/profileDiscovery.js";
import { Reporter } from "./lib/reporter.js";
import {
	removeInheritedSettingsFromFile,
	syncSettings,
} from "./lib/settings.js";
import { syncSnippets } from "./lib/snippets.js";
import { syncTasks } from "./lib/tasks.js";

/**
 * Updates the inherited settings for the current profile.
 * @param context Extension context.
 */
export async function updateCurrentProfileInheritance(
	context: vscode.ExtensionContext,
): Promise<void> {
	Logger.initialize(context);

	const config = vscode.workspace.getConfiguration("inheritProfile");
	const parents = config.get<string[]>("parents", []);

	if (parents.length === 0) {
		Logger.info(
			"No parent profiles configured. Skipping inheritance update.",
			"Main",
		);
		return;
	}

	const currentProfileName = await getCurrentProfileName(context);

	Reporter.initialize(currentProfileName, parents);
	Logger.info("Starting profile inheritance update...", "Main");

	// Sync extensions
	await syncExtensions(context);

	// Sync settings
	await syncSettings(context);

	// Sync keybindings
	await syncKeybindings(context);

	// Sync tasks
	await syncTasks(context);

	// Sync snippets
	await syncSnippets(context);

	// Sync MCP servers
	await syncMcp(context);

	Logger.info("Profile inheritance update completed.", "Main");

	await Reporter.showSummary();
}

/**
 * Removes the inherited settings from the current profile.
 * @param context Extension context.
 */
export async function removeCurrentProfileInheritedSettings(
	context: vscode.ExtensionContext,
): Promise<void> {
	const currentProfileName = await getCurrentProfileName(context);
	const profiles = await getProfileMap(context);
	const currentProfileDirectory = profiles[currentProfileName];
	if (!currentProfileDirectory) {
		Logger.error(
			`Unable to find current profile directory for \`${currentProfileName}\` profile.`,
			undefined,
			"Main",
		);
	}
	const currentProfilePath = path.join(
		currentProfileDirectory,
		"settings.json",
	);
	await removeInheritedSettingsFromFile(currentProfilePath);

	vscode.window.showInformationMessage(
		"Inherited settings remove from current profile!",
	);
}

/**
 * Updates the inherited settings when the profile changes.
 * @param context Extension context.
 */
export async function updateInheritedSettingsOnProfileChange(
	context: vscode.ExtensionContext,
) {
	const globalStoragePath = getGlobalStoragePath(context);
	let currentProfile = await getCurrentProfileName(context);

	const watcher = vscode.workspace.createFileSystemWatcher(globalStoragePath);
	const onChange = async () => {
		const newProfileName = await getCurrentProfileName(context);
		if (newProfileName !== currentProfile) {
			currentProfile = newProfileName;
			Logger.info(
				"Current profile has changed, updating inherited settings...",
				"Main",
			);
			await updateCurrentProfileInheritance(context);
		}
	};
	watcher.onDidChange(onChange);
	watcher.onDidCreate(onChange);
	watcher.onDidDelete(onChange);

	context.subscriptions.push(watcher);
}
