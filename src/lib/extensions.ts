import * as fs from "node:fs/promises";
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
		Logger.warn(`Profile '${profileName}' not found.`, "Extensions");
		return [];
	}

	// For Default profile, scan the global extensions directory
	if (profileName === "Default") {
		try {
			// context.extensionPath is e.g. /Users/user/.vscode/extensions/my-ext-version
			// So parent dir is /Users/user/.vscode/extensions
			const extensionsDir = path.dirname(context.extensionPath);
			const entries = await fs.readdir(extensionsDir, {
				withFileTypes: true,
			});

			const foundExtensions = new Set<string>();

			for (const entry of entries) {
				if (entry.isDirectory() && !entry.name.startsWith(".")) {
					// Format: publisher.name-version
					// e.g. ms-python.python-2023.1.0
					const match = entry.name.match(/^(.+)-(\d+\.\d+\.\d+)$/);
					if (match) {
						foundExtensions.add(match[1].toLowerCase());
					}
				}
			}

			const result = Array.from(foundExtensions).map((id) => ({
				identifier: { id },
			}));
			Logger.info(
				`Found ${result.length} extensions in 'Default' profile.`,
				"Extensions",
			);
			return result;
		} catch (error) {
			Logger.error(
				"Failed to scan global extensions directory.",
				error as Error,
				"Extensions",
			);
			return [];
		}
	}

	// For custom profiles, read extensions.json
	const extensionsPath = path.join(profilePath, "extensions.json");
	const extensions = await readJSON(extensionsPath, true);

	if (Array.isArray(extensions)) {
		Logger.info(
			`Found ${extensions.length} extensions in '${profileName}' profile.`,
			"Extensions",
		);
		return extensions;
	}

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

	// Get currently installed extensions
	const currentExtensions = getActiveExtensions();
	const installedIds = new Set(
		currentExtensions.map((e) => e.identifier?.id.toLowerCase()),
	);
	Logger.info(
		`Current profile '${currentProfileName}' has ${installedIds.size} extensions installed.`,
		"Extensions",
	);

	// Iterate over parents and install missing extensions
	let totalInstalled = 0;
	for (const parent of parentProfiles) {
		const extensions = await getProfileExtensions(context, parent);
		let installedFromParent = 0;

		for (const ext of extensions) {
			const id = (ext as Extension).identifier?.id;
			if (id && !installedIds.has(id.toLowerCase())) {
				Logger.info(`Installing '${id}' from '${parent}'...`, "Extensions");
				try {
					await vscode.commands.executeCommand(
						"workbench.extensions.installExtension",
						id,
						{ donotSync: true },
					);
					installedIds.add(id.toLowerCase());
					Reporter.trackExtension(id, "added");
					installedFromParent++;
				} catch (err) {
					Logger.error(`Failed to install '${id}'`, err, "Extensions");
					Reporter.trackExtension(id, "failed");
				}
			}
		}

		if (installedFromParent > 0) {
			Logger.info(
				`Installed ${installedFromParent} extensions from '${parent}'.`,
				"Extensions",
			);
		}
		totalInstalled += installedFromParent;
	}

	if (totalInstalled === 0) {
		Logger.info("All extensions already installed.", "Extensions");
	} else {
		Logger.info(`Total: ${totalInstalled} extensions installed.`, "Extensions");
	}
}
