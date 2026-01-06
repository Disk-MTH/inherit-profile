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

interface DisabledExtension {
	id: string;
}

/**
 * Gets the path to the global extensions directory.
 * Default: ~/.vscode/extensions
 */
export function getGlobalExtensionsDir(): string {
	return path.join(os.homedir(), ".vscode", "extensions");
}

/**
 * Gets the disabled extensions for a profile from state.vscdb.
 */
async function getDisabledExtensions(
	context: vscode.ExtensionContext,
	profileName: string,
): Promise<Set<string>> {
	const profileMap = await getProfileMap(context);
	const profilePath = profileMap[profileName];
	if (!profilePath) {
		return new Set();
	}

	const stateDbPath = path.join(profilePath, "globalStorage", "state.vscdb");

	try {
		const { exec } = await import("node:child_process");
		const { promisify } = await import("node:util");
		const execAsync = promisify(exec);

		const query = `SELECT value FROM ItemTable WHERE key = 'extensionsIdentifiers/disabled'`;
		const { stdout } = await execAsync(`sqlite3 "${stateDbPath}" "${query}"`);

		if (stdout.trim()) {
			const disabled: DisabledExtension[] = JSON.parse(stdout.trim());
			const ids = new Set(disabled.map((d) => d.id.toLowerCase()));
			if (ids.size > 0) {
				Logger.info(
					`Found ${ids.size} disabled extensions in '${profileName}'`,
					"Extensions",
				);
			}
			return ids;
		}
	} catch {
		// Database might not exist or query failed
	}

	return new Set();
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
		const ids = extensions
			.map((ext: Extension) => ext.identifier?.id)
			.filter((id): id is string => typeof id === "string");
		Logger.info(
			`Found ${ids.length} extensions in '${profileName}' profile`,
			"Extensions",
		);
		return ids;
	}

	Logger.warn(
		`No extensions.json found for '${profileName}' profile`,
		"Extensions",
	);
	return [];
}

/**
 * Gets extensions to inherit from parent profiles.
 * Only includes extensions that are ENABLED in the parent (not disabled).
 * Returns a map of extension ID to the parent it comes from.
 */
async function getParentExtensions(
	context: vscode.ExtensionContext,
	parentProfiles: string[],
): Promise<Map<string, string>> {
	const extensionMap = new Map<string, string>();

	for (const parent of parentProfiles) {
		const allExtensions = await getProfileExtensions(context, parent);
		const disabledExtensions = await getDisabledExtensions(context, parent);

		// Only include extensions that are NOT disabled in this parent
		for (const id of allExtensions) {
			const lowerId = id.toLowerCase();
			if (!disabledExtensions.has(lowerId)) {
				// Later parents override earlier ones
				extensionMap.set(lowerId, parent);
			}
		}
	}

	return extensionMap;
}

/**
 * Gets the set of currently installed extension IDs.
 */
function getInstalledExtensionIds(): Set<string> {
	return new Set(
		vscode.extensions.all
			.filter((ext) => !ext.packageJSON.isBuiltin)
			.map((ext) => ext.id.toLowerCase()),
	);
}

/**
 * Synchronizes extensions from parent profiles to the current profile.
 * Installs missing extensions that are enabled in parent profiles.
 */
export async function syncExtensions(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("inheritProfile");

	if (!config.get<boolean>("extensions", true)) {
		return;
	}

	const parentProfiles = config.get<string[]>("parents", []);
	if (parentProfiles.length === 0) {
		return;
	}

	const currentProfileName = await getCurrentProfileName(context);
	const installedIds = getInstalledExtensionIds();

	Logger.info(
		`Current profile '${currentProfileName}' has ${installedIds.size} extensions`,
		"Extensions",
	);

	// Get extensions from all parent profiles
	const parentExtensions = await getParentExtensions(context, parentProfiles);
	Logger.info(
		`Found ${parentExtensions.size} extensions in parent profiles`,
		"Extensions",
	);

	// Track extensions by parent for reporting
	const extensionsByParent = new Map<string, string[]>();
	for (const [id, source] of parentExtensions) {
		if (!extensionsByParent.has(source)) {
			extensionsByParent.set(source, []);
		}
		extensionsByParent.get(source)?.push(id);
	}
	Reporter.trackExtensionsByParent(extensionsByParent);

	// Install missing extensions
	let installedCount = 0;
	let failedCount = 0;

	for (const [lowerId, source] of parentExtensions) {
		if (installedIds.has(lowerId)) {
			continue;
		}

		Logger.info(`Installing '${lowerId}' from '${source}'...`, "Extensions");
		try {
			await vscode.commands.executeCommand(
				"workbench.extensions.installExtension",
				lowerId,
				{ donotSync: true },
			);
			Reporter.trackExtensionResult(lowerId, "installed");
			installedCount++;
		} catch (err) {
			Logger.error(`Failed to install '${lowerId}'`, err, "Extensions");
			Reporter.trackExtensionResult(lowerId, "failed");
			failedCount++;
		}
	}

	// Summary
	if (installedCount === 0 && failedCount === 0) {
		Logger.info("All extensions already installed.", "Extensions");
	} else {
		const parts: string[] = [];
		if (installedCount > 0) parts.push(`${installedCount} installed`);
		if (failedCount > 0) parts.push(`${failedCount} failed`);
		Logger.info(`Extensions sync complete: ${parts.join(", ")}`, "Extensions");
	}
}
