import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "./logger.js";
import { getCurrentProfileName, getProfileMap } from "./profileDiscovery.js";
import { Reporter } from "./reporter.js";
import {
	findTabValue,
	flattenSettings,
	insertBeforeClose,
	mergeFlattenedSettings,
	readJSON,
	readRawSettingsFile,
	removeTrailingComma,
	sortSettings,
	splitRawSettingsByClosingBrace,
} from "./utils.js";

const INHERITED_SETTINGS_START_MARKER =
	"// --- INHERITED SETTINGS MARKER START --- //";
const INHERITED_SETTINGS_END_MARKER =
	"// --- INHERITED SETTINGS MARKER END --- //";

const WARNING_COMMENT =
	"// WARNING: Do not remove the inherited settings start and end markers";
const WARNING_EXPLAIN =
	"//          The markers are used to identify inserted inherited settings";

/**
 * Collects the settings for each of the profiles.
 *
 * This function will start with the first profile in the list. This function
 * will override properties that are redefined in profiles that appear towards
 * the end of the list.
 * @param context Extension context.
 * @param profiles List of profiles to collect settings for.
 * @returns Flattened settings from the provided profiles.
 */
export async function getProfileSettings(
	context: vscode.ExtensionContext,
	profiles: string[],
): Promise<Record<string, string>> {
	const profileMap: Record<string, string> = await getProfileMap(context);
	var settings: Record<string, string> = {};
	for (const profileName of profiles) {
		const profilePath = profileMap[profileName];
		if (!profilePath) {
			Logger.warn(`Profile '${profileName}' not found.`, "Settings");
			continue;
		}
		const settingsPath = path.join(profilePath, "settings.json");

		const profileSettings = flattenSettings(
			(await readJSON(settingsPath, true)) as Record<string, unknown>,
		);
		const count = Object.keys(profileSettings).length;
		if (count > 0) {
			Logger.info(
				`Found ${count} settings in '${profileName}' profile`,
				"Settings",
			);
		}
		settings = mergeFlattenedSettings(
			settings,
			profileSettings as Record<string, string>,
		);
	}
	return flattenSettings(settings) as Record<string, string>;
}

/**
 * Gets the settings for the current profile.
 * @param context Extension context.
 * @returns Returns the flattened settings for the current profile.
 */
export async function getCurrentProfileSettings(
	context: vscode.ExtensionContext,
): Promise<Record<string, string>> {
	const currentProfileName = await getCurrentProfileName(context);
	return await getProfileSettings(context, [currentProfileName]);
}

/**
 * Gets the inherited settings organized by parent profile.
 * @param context Extension context.
 * @returns Map of parent name to list of setting keys inherited from that parent.
 */
export async function getInheritedSettingsByParent(
	context: vscode.ExtensionContext,
): Promise<{
	byParent: Map<string, string[]>;
	merged: Record<string, string>;
}> {
	const currentProfileSettings = await getCurrentProfileSettings(context);
	const config = vscode.workspace.getConfiguration("inheritProfile");
	const parentProfiles = config.get<string[]>("parents", []);

	const byParent = new Map<string, string[]>();
	const alreadyInherited = new Set<string>(Object.keys(currentProfileSettings));
	let merged: Record<string, string> = {};

	const profileMap = await getProfileMap(context);

	// Process each parent in order
	for (const profileName of parentProfiles) {
		const profilePath = profileMap[profileName];
		if (!profilePath) continue;

		const settingsPath = path.join(profilePath, "settings.json");
		const profileSettings = flattenSettings(
			(await readJSON(settingsPath, true)) as Record<string, unknown>,
		) as Record<string, string>;

		const newFromThisParent: string[] = [];

		for (const key of Object.keys(profileSettings)) {
			if (!alreadyInherited.has(key)) {
				newFromThisParent.push(key);
				alreadyInherited.add(key);
				merged[key] = profileSettings[key];
			}
		}

		if (newFromThisParent.length > 0) {
			byParent.set(profileName, newFromThisParent.sort());
		}
	}

	merged = sortSettings(merged);
	return { byParent, merged };
}

/**
 * Gets the settings that are missing from the current profile.
 * @param context Extension context.
 * @returns Returns the flattened settings that are missing from the current profile.
 */
export async function getInheritedSettings(
	context: vscode.ExtensionContext,
): Promise<Record<string, string>> {
	const { merged } = await getInheritedSettingsByParent(context);
	return merged;
}

/**
 * Removes the inherited settings block (including the markers) from a settings
 * file.
 *
 * If no markers are found, the file is left unchanged.
 */
export async function removeInheritedSettingsFromFile(
	settingsPath: string,
): Promise<void> {
	// Find the start and end markers:
	const raw = await readRawSettingsFile(settingsPath);
	const startIndex = raw.indexOf(INHERITED_SETTINGS_START_MARKER);
	const endIndex = raw.indexOf(INHERITED_SETTINGS_END_MARKER);

	// Ensure the markers exist:
	if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
		if (startIndex !== endIndex) {
			Logger.warn(
				"Either the start or end marker is missing in the current profile",
				"Settings",
			);
		}
		return; // markers not found, leave file alone
	}

	// Clean response:
	const before = raw.slice(0, startIndex);
	const after = raw.slice(endIndex + INHERITED_SETTINGS_END_MARKER.length);
	let cleaned = before.trimEnd() + after.trimEnd();

	// Ensure JSONC ends properly:
	cleaned = removeTrailingComma(cleaned);
	if (!cleaned.endsWith("}")) {
		cleaned += "\n}";
	}

	// Write cleaned file:
	await fs.writeFile(settingsPath, `${cleaned}\n`, "utf8");
}

/**
 * Writes a set of inherited settings to a settings path.
 *
 * IMPORTANT: This function assumes that there are no inherited settings in the
 * file. Any inherited settings should be removed before calling this function.
 */
export async function writeInheritedSettings(
	settingsPath: string,
	flattened: Record<string, unknown>,
): Promise<void> {
	// Early exit if there is nothing to add:
	if (Object.keys(flattened).length === 0) {
		return;
	}

	// Read the raw file, split it by the closing brace, and get the tab size
	// for formatting:
	const raw = await readRawSettingsFile(settingsPath);
	const [beforeClose, afterClose] = await splitRawSettingsByClosingBrace(raw);
	const tab = findTabValue(raw);

	// Build the inherited settings block:
	const block = buildInheritedSettingsBlock(
		flattened as Record<string, string>,
		tab,
	);

	// Insert the inherited settings block between the before and after closing
	// brace blocks:
	const beforeClosePlusBlock = insertBeforeClose(beforeClose, block);
	const finalSettings = beforeClosePlusBlock + afterClose;

	// Write the final settings to the settings path:
	await fs.writeFile(settingsPath, finalSettings, "utf8");
}

/**
 * Builds the inherited settings block with start, warning, entries, and end.
 *
 * @param flattened Flattened settings to insert into the settings block.
 * @param tab Tab sequence to use.
 * @returns Returns the raw inherited settings block.
 */
function buildInheritedSettingsBlock(
	flattened: Record<string, string>,
	tab: string,
): string {
	const entries = Object.entries(flattened)
		.map(([key, value]) => `${tab}"${key}": ${JSON.stringify(value)}`)
		.join(",\n");

	return (
		tab +
		INHERITED_SETTINGS_START_MARKER +
		"\n" +
		tab +
		WARNING_COMMENT +
		"\n" +
		tab +
		WARNING_EXPLAIN +
		"\n" +
		entries +
		(entries ? "\n" : "") +
		tab +
		INHERITED_SETTINGS_END_MARKER +
		"\n"
	);
}

/**
 * Applies the inherited settings to the current profile.
 * @param context Extension context.
 */
export async function syncSettings(
	context: vscode.ExtensionContext,
): Promise<void> {
	// Get the path to the current profile settings:
	const currentProfileName = await getCurrentProfileName(context);
	const profiles = await getProfileMap(context);
	const currentProfileDirectory = profiles[currentProfileName];
	if (!currentProfileDirectory) {
		Logger.error(
			`Unable to find current profile directory for \`${currentProfileName}\` profile`,
			undefined,
			"Settings",
		);
		return;
	}
	const currentProfilePath = path.join(
		currentProfileDirectory,
		"settings.json",
	);

	// Remove the inherited settings from the current profile:
	await removeInheritedSettingsFromFile(currentProfilePath);

	// Get the settings that the current profile should inherit:
	const { byParent, merged } = await getInheritedSettingsByParent(context);
	const totalInheritedSettings = Object.keys(merged).length;

	// Track settings by parent for the report
	Reporter.trackSettingsByParent(byParent);

	if (totalInheritedSettings === 0) {
		Logger.info("No new settings to inherit.", "Settings");
		return;
	}

	Logger.info(
		`Inheriting ${totalInheritedSettings} settings from parents`,
		"Settings",
	);

	// Add the inherited settings to the end of the profile:
	await writeInheritedSettings(currentProfilePath, merged);
}
