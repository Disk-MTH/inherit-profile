import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "./logger.js";
import { getCurrentProfileName, getProfileMap } from "./profileDiscovery.js";
import { Reporter } from "./reporter.js";
import { readJSON } from "./utils.js";

interface Keybinding {
	key: string;
	command: string;
	when?: string;
	args?: unknown;
}

export async function syncKeybindings(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("inheritProfile");
	if (!config.get<boolean>("keybindings", true)) {
		return;
	}

	Logger.section("Keybindings Sync");

	const parentProfiles = config.get<string[]>("parents", []);
	if (parentProfiles.length === 0) {
		Logger.info("No parent profiles configured.", "Keybindings");
		return;
	}

	const profileMap = await getProfileMap(context);
	const currentProfileName = await getCurrentProfileName(context);
	const currentProfilePath = profileMap[currentProfileName];

	if (!currentProfilePath) {
		Logger.error(
			`Current profile path not found for ${currentProfileName}`,
			undefined,
			"Keybindings",
		);
		return;
	}

	let aggregatedKeybindings: Keybinding[] = [];

	// 1. Collect Parent Keybindings
	for (const parent of parentProfiles) {
		const parentPath = profileMap[parent];
		if (!parentPath) {
			Logger.warn(`Parent profile '${parent}' not found.`, "Keybindings");
			continue;
		}

		const keybindingsPath = path.join(parentPath, "keybindings.json");
		const keybindings = (await readJSON(keybindingsPath, true)) as Keybinding[];

		if (Array.isArray(keybindings)) {
			Logger.info(
				`Loaded ${keybindings.length} keybindings from parent '${parent}'.`,
				"Keybindings",
			);
			aggregatedKeybindings = [...aggregatedKeybindings, ...keybindings];
		}
	}

	// 2. Read Current Profile Keybindings (to preserve user overrides)
	const currentKeybindingsPath = path.join(
		currentProfilePath,
		"keybindings.json",
	);
	try {
		const currentObjs = (await readJSON(
			currentKeybindingsPath,
			true,
		)) as (Keybinding & {
			__inherited?: boolean;
		})[];
		const userKeybindings = Array.isArray(currentObjs)
			? currentObjs.filter((k) => !k.__inherited)
			: [];

		const newInheritedKeybindings = aggregatedKeybindings.map((k) => ({
			...k,
			__inherited: true,
		}));

		// Merge: Inherited first, then User.
		const finalKeybindings = [...newInheritedKeybindings, ...userKeybindings];

		await fs.writeFile(
			currentKeybindingsPath,
			JSON.stringify(finalKeybindings, null, 4),
		);
		Logger.info(
			`Synced ${newInheritedKeybindings.length} inherited keybindings.`,
			"Keybindings",
		);
		Reporter.trackKeybindings(newInheritedKeybindings.length);
	} catch (error) {
		Logger.error("Failed to sync keybindings", error, "Keybindings");
	}
}
