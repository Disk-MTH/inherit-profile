import * as os from "node:os";
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
 * Gets the path to the global extensions directory.
 * Default: ~/.vscode/extensions
 */
export function getGlobalExtensionsDir(): string {
	return path.join(os.homedir(), ".vscode", "extensions");
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
 * @param globalExtensionsDir Optional override for global extensions directory (for testing).
 * @returns List of extension IDs.
 */
export async function getProfileExtensions(
	context: vscode.ExtensionContext,
	profileName: string,
	globalExtensionsDir?: string,
): Promise<string[]> {
	const profileMap = await getProfileMap(context);
	const profilePath = profileMap[profileName];
	if (!profilePath) {
		Logger.warn(`Profile '${profileName}' not found.`, "Extensions");
		return [];
	}

	// Default profile uses ~/.vscode/extensions/extensions.json
	// Custom profiles use their own extensions.json in their profile folder
	const isDefault = profileName === "Default";
	const extensionsPath = isDefault
		? path.join(
				globalExtensionsDir ?? getGlobalExtensionsDir(),
				"extensions.json",
			)
		: path.join(profilePath, "extensions.json");

	const extensions = await readJSON(extensionsPath, true);

	if (Array.isArray(extensions)) {
		// Extract extension IDs from the extensions.json format
		const ids = extensions
			.map((ext: Extension) => ext.identifier?.id)
			.filter((id): id is string => typeof id === "string");
		Logger.info(
			`Found ${ids.length} extensions in '${profileName}' profile.`,
			"Extensions",
		);
		return ids;
	}

	Logger.warn(
		`No extensions.json found for '${profileName}' profile.`,
		"Extensions",
	);
	return [];
}

/**
 * Merges extensions from parent profiles using hierarchy rules.
 * Later parents override earlier parents, child overrides all.
 * @param parentProfiles List of parent profile names (in order).
 * @param context Extension context.
 * @returns Set of extension IDs to inherit.
 */
export async function mergeParentExtensions(
	context: vscode.ExtensionContext,
	parentProfiles: string[],
): Promise<Set<string>> {
	const mergedExtensions = new Set<string>();

	// Process parents in order - later parents override earlier ones
	for (const parent of parentProfiles) {
		const extensions = await getProfileExtensions(context, parent);
		for (const id of extensions) {
			mergedExtensions.add(id.toLowerCase());
		}
		Logger.info(
			`Merged ${extensions.length} extensions from '${parent}'.`,
			"Extensions",
		);
	}

	return mergedExtensions;
}

/**
 * Synchronizes extensions from parent profiles to the current profile.
 * Uses hierarchy: parents are merged in order, child profile prevails.
 */
export async function syncExtensions(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("inheritProfile");

	// Check if extension sync is enabled
	if (!config.get<boolean>("extensions", true)) {
		return;
	}

	const parentProfiles = config.get<string[]>("parents", []);
	if (parentProfiles.length === 0) {
		return;
	}

	const currentProfileName = await getCurrentProfileName(context);

	// Get currently installed extensions (child profile)
	const currentExtensions = getActiveExtensions();
	const installedIds = new Set(
		currentExtensions
			.map((e) => e.identifier?.id.toLowerCase())
			.filter((id): id is string => !!id),
	);
	Logger.info(
		`Current profile '${currentProfileName}' has ${installedIds.size} extensions.`,
		"Extensions",
	);

	// Merge all parent extensions using hierarchy
	const parentExtensions = await mergeParentExtensions(context, parentProfiles);
	Logger.info(
		`Parents provide ${parentExtensions.size} unique extensions.`,
		"Extensions",
	);

	// Find extensions to install (in parents but not in child)
	const toInstall: string[] = [];
	for (const id of parentExtensions) {
		if (!installedIds.has(id)) {
			toInstall.push(id);
		}
	}

	if (toInstall.length === 0) {
		Logger.info("All parent extensions already installed.", "Extensions");
		return;
	}

	Logger.info(
		`Installing ${toInstall.length} extensions from parents...`,
		"Extensions",
	);

	// Install missing extensions
	let installed = 0;
	for (const id of toInstall) {
		Logger.info(`Installing '${id}'...`, "Extensions");
		try {
			await vscode.commands.executeCommand(
				"workbench.extensions.installExtension",
				id,
				{ donotSync: true },
			);
			Reporter.trackExtension(id, "added");
			installed++;
		} catch (err) {
			Logger.error(`Failed to install '${id}'`, err, "Extensions");
			Reporter.trackExtension(id, "failed");
		}
	}

	Logger.info(
		`Installed ${installed}/${toInstall.length} extensions.`,
		"Extensions",
	);
}
