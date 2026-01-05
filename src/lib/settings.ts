import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "./logger.js";
import { Reporter } from "./reporter.js";
import { getCurrentProfileName, getProfileMap } from "./profileDiscovery.js";
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
	subtractSettings,
} from "./utils.js";

const INHERITED_SETTINGS_START_MARKER =
	"// --- INHERITED SETTINGS MARKER START --- //";
const INHERITED_SETTINGS_END_MARKER =
	"// --- INHERITED SETTINGS MARKER END --- //";

const WARNING_COMMENT =
	"// WARNING: Do not remove the inherited settings start and end markers.";
const WARNING_EXPLAIN =
	"//          The markers are used to identify inserted inherited settings.";

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
	Logger.info(
		`Collecting settings from ${profiles.length} different profiles.`,
		"Settings",
	);
	for (const profileName of profiles) {
		const profilePath = profileMap[profileName];
		if (!profilePath) {
			Logger.warn(
				`Failed to collect settings for profile ${profileName}: Profile does not exist.`,
				"Settings",
			);
			continue;
		}
		const settingsPath = path.join(profilePath, "settings.json");

		const profileSettings = flattenSettings(
			(await readJSON(settingsPath, true)) as Record<string, unknown>,
		);
		Logger.info(
			`Found ${Object.keys(profileSettings).length} settings from \`${settingsPath}\`.`,
			"Settings",
		);
		settings = mergeFlattenedSettings(
			settings,
			profileSettings as Record<string, string>,
		);
		Logger.info(
			`Merged ${settingsPath} into collected settings. Current total settings ${Object.keys(settings).length}.`,
			"Settings",
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
 * Gets the settings that are missing from the current profile.
 * @param context Extension context.
 * @returns Returns the flattened settings that are missing from the current profile.
 */
export async function getInheritedSettings(
	context: vscode.ExtensionContext,
): Promise<Record<string, string>> {
	const currentProfileSettings = await getCurrentProfileSettings(context);
	Logger.info(
		`Found ${Object.keys(currentProfileSettings).length} settings in current profile.`,
		"Settings",
	);

	const config = vscode.workspace.getConfiguration("inheritProfile");
	const parentProfiles = config.get<string[]>("parents", []);
	const parentProfileSettings = await getProfileSettings(
		context,
		parentProfiles,
	);
	Logger.info(
		`Found ${Object.keys(parentProfileSettings).length} settings in parent profiles.`,
		"Settings",
	);

	const inheritedSettings = subtractSettings(
		parentProfileSettings,
		currentProfileSettings,
	);
	Logger.info(
		`Found ${Object.keys(inheritedSettings).length} inherited in from parent profiles.`,
		"Settings",
	);

	const sortedInheritedSettings = sortSettings(inheritedSettings);
	return sortedInheritedSettings;
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
	Logger.info(`Removing inherited settings from \`${settingsPath}\`.`, "Settings");

	// Find the start and end markers:
	const raw = await readRawSettingsFile(settingsPath);
	const startIndex = raw.indexOf(INHERITED_SETTINGS_START_MARKER);
	const endIndex = raw.indexOf(INHERITED_SETTINGS_END_MARKER);

	// Ensure the markers exist:
	if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
		if (startIndex !== endIndex) {
			Logger.warn(
				"Either the start or end marker is missing in the current profile.",
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
export async function applyInheritedSettings(
	context: vscode.ExtensionContext,
): Promise<void> {
	// Get the path to the current profile settings:
	const currentProfileName = await getCurrentProfileName(context);
	const profiles = await getProfileMap(context);
	const currentProfileDirectory = profiles[currentProfileName];
	if (!currentProfileDirectory) {
		Logger.error(
			`Unable to find current profile directory for \`${currentProfileName}\` profile.`,
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
	const inheritedSettings = await getInheritedSettings(context);
	const totalInheritedSettings = Object.keys(inheritedSettings).length;
	Logger.info(
		`Found ${totalInheritedSettings} inherited settings for \`${currentProfileName}\` profile.`,
		"Settings",
	);
	
	const config = vscode.workspace.getConfiguration("inheritProfile");
	const parentProfiles = config.get<string[]>("parents", []);
	Reporter.trackSettings(totalInheritedSettings, parentProfiles);

	if (totalInheritedSettings === 0) {
		return;
	}

	// Add the inherited settings to the end of the profile:
	Logger.info(
		`Merging ${totalInheritedSettings} settings into \`${currentProfilePath}\`.`,
		"Settings",
	);
	await writeInheritedSettings(currentProfilePath, inheritedSettings);
}
