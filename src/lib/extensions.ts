import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "./logger.js";
import { getCurrentProfileName, getProfileMap } from "./profileDiscovery.js";
import { Reporter } from "./reporter.js";
import { readJSON } from "./utils.js";

interface Extension {
	identifier?: { id: string };
}

/**
 * Gets the list of active extensions in the current VS Code window.
 * @returns List of extensions (identifiers).
 */
export function getActiveExtensions(): Extension[] {
	return vscode.extensions.all
		.filter((ext) => !ext.packageJSON.isBuiltin)
		.map((ext) => ({ identifier: { id: ext.id } }));
}

/**
 * Gets the list of extensions for a given profile from disk.
 * @param context Extension context.
 * @param profileName Name of the profile.
 * @returns List of extensions (identifiers).
 */
export async function getProfileExtensions(
	context: vscode.ExtensionContext,
	profileName: string,
): Promise<unknown[]> {
	const profileMap = await getProfileMap(context);
	const profilePath = profileMap[profileName];
	if (!profilePath) {
		Logger.warn(`Profile ${profileName} not found.`, "Extensions");
		return [];
	}

	const extensionsPath = path.join(profilePath, "extensions.json");
	// Logger.info(`Reading extensions from ${extensionsPath}`, "Extensions");

	// Pass true to suppress error logging if file doesn't exist (e.g. Default profile)
	const extensions = await readJSON(extensionsPath, true);
	// extensions.json usually contains an array of objects with "identifier" property
	// e.g. [ { "identifier": { "id": "pub.ext" }, ... } ]

	if (Array.isArray(extensions)) {
		// Logger.info(`Found ${extensions.length} extensions in ${profileName}`, "Extensions");
		return extensions;
	}

	// Logger.info(`No extensions found or invalid format in ${profileName}`, "Extensions");
	return [];
}

/**
 * Synchronizes extensions from parent profiles to the current profile.
 */
export async function syncExtensions(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("inheritProfile");

	// Check if extension sync is enabled
	if (!config.get<boolean>("extensions", true)) {
		return;
	}

	Logger.section("Extensions Sync");

	const parentProfiles = config.get<string[]>("parents", []);
	if (parentProfiles.length === 0) {
		return;
	}

	const currentProfileName = await getCurrentProfileName(context);
	Logger.info(
		`Synchronizing extensions for profile '${currentProfileName}'...`,
		"Extensions",
	);

	// Get currently installed extensions
	const currentExtensions = getActiveExtensions();
	const installedIds = new Set(
		currentExtensions.map((e) => e.identifier?.id.toLowerCase()),
	);

	// Iterate over parents and install missing extensions
	for (const parent of parentProfiles) {
		const extensions = await getProfileExtensions(context, parent);

		for (const ext of extensions) {
			const id = (ext as Extension).identifier?.id;
			if (id) {
				if (!installedIds.has(id.toLowerCase())) {
					Logger.info(
						`Installing missing extension '${id}' from parent '${parent}'...`,
						"Extensions",
					);
					try {
						await vscode.commands.executeCommand(
							"workbench.extensions.installExtension",
							id,
							{
								donotSync: true,
							},
						);
						installedIds.add(id.toLowerCase());
						Reporter.trackExtension(id, "added");
					} catch (err) {
						Logger.error(`Failed to install '${id}'`, err, "Extensions");
						Reporter.trackExtension(id, "failed");
					}
				} else {
					// Extension already installed, but we want to report it as "synced" or "checked"?
					// The user complained that "no changes" was reported when extensions were synced.
					// If they were already there, "No changes" is technically correct.
					// But if the user *just* ran it and it installed them, it should show up.
					// If the user ran it *again*, it should show "No changes" for extensions.
					// Wait, the user said: "quand j'ai fait apply sur le child, ca m'a ouvert le markdown, mais il il m'a dis no changes alors qu'il a bien sync ext + settings"
					// This implies that extensions WERE installed but NOT reported.
					// This happens if `installedIds.has(id.toLowerCase())` was TRUE initially?
					// Or if `vscode.commands.executeCommand` finished but `Reporter.trackExtension` wasn't called?
					// It is awaited.
					// Maybe `getActiveExtensions()` returns extensions that are currently *installing*? Unlikely.
					// Let's add a debug log to see what's happening.
					// Logger.info(`Extension ${id} already installed.`, "Extensions");
				}
			}
		}
	}
	Logger.info("Extension synchronization complete.", "Extensions");
}
