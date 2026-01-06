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
 * Reads and flattens settings from a profile directory.
 */
async function readProfileSettings(
	profilePath: string,
): Promise<Record<string, string>> {
	const settingsPath = path.join(profilePath, "settings.json");
	const json = await readJSON(settingsPath, true);
	return flattenSettings(json as Record<string, unknown>) as Record<
		string,
		string
	>;
}

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

		const profileSettings = await readProfileSettings(profilePath);
		const count = Object.keys(profileSettings).length;
		if (count > 0) {
			Logger.info(
				`Found ${count} settings in '${profileName}' profile`,
				"Settings",
			);
		}
		settings = mergeFlattenedSettings(settings, profileSettings);
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
	byParent: Map<string, Record<string, string>>;
	merged: Record<string, string>;
}> {
	const currentProfileSettings = await getCurrentProfileSettings(context);
	const currentProfileName = await getCurrentProfileName(context);
	const config = vscode.workspace.getConfiguration("inheritProfile");
	const parentProfiles = config.get<string[]>("parents", []);

	const byParent = new Map<string, Record<string, string>>();
	const alreadyInherited = new Set<string>();

	// Add local settings first
	const localSettings = Object.keys(currentProfileSettings).sort();
	if (localSettings.length > 0) {
		const localSettingsRecord: Record<string, string> = {};
		for (const key of localSettings) {
			localSettingsRecord[key] = currentProfileSettings[key];
			alreadyInherited.add(key);
		}
		byParent.set(currentProfileName, localSettingsRecord);
	}

	let merged: Record<string, string> = {};

	const profileMap = await getProfileMap(context);

	// Process each parent in REVERSE order (closest parent first, to allow overrides)
	const hierarchy = [...parentProfiles].reverse();

	for (const profileName of hierarchy) {
		const profilePath = profileMap[profileName];
		if (!profilePath) continue;

		const profileSettings = await readProfileSettings(profilePath);

		const newFromThisParent: Record<string, string> = {};

		for (const key of Object.keys(profileSettings)) {
			if (!alreadyInherited.has(key)) {
				newFromThisParent[key] = profileSettings[key];
				alreadyInherited.add(key);
				merged[key] = profileSettings[key];
			}
		}

		if (Object.keys(newFromThisParent).length > 0) {
			byParent.set(profileName, sortSettings(newFromThisParent));
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
 * Removes the settings (both legacy markers and new header-based blocks) from the file.
 * Preserves the current profile's local settings.
 */
export async function removeInheritedSettingsFromFile(
	settingsPath: string,
	currentProfileName: string,
	parents: string[],
): Promise<void> {
	let raw = await readRawSettingsFile(settingsPath);

	// 1. Remove legacy markers block if found
	const startIndex = raw.indexOf(INHERITED_SETTINGS_START_MARKER);
	const endIndex = raw.indexOf(INHERITED_SETTINGS_END_MARKER);

	if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
		const before = raw.slice(0, startIndex);
		const after = raw.slice(endIndex + INHERITED_SETTINGS_END_MARKER.length);
		raw = before.trimEnd() + after.trimEnd();
		if (!raw.endsWith("}")) {
			raw += "\n}";
		}
	}

	// 2. Parse file line by line to remove inherited parent headers and their content
	// We want to keep:
	// - Content under `// --- ${currentProfileName} (current) --- //`
	// - Content not under any header (legacy local settings)
	// We want to remove:
	// - Content under `// --- ${parent} --- //`

	const lines = raw.split("\n");
	const outputLines: string[] = [];
	let skip = false;

	// Normalize header format check
	const getHeaderName = (line: string): string | null => {
		const match = line.match(/^\s*\/\/ --- (.*?) --- \/\/\s*$/);
		return match ? match[1] : null;
	};

	const currentHeader = `${currentProfileName} (current)`;

	for (const line of lines) {
		const headerName = getHeaderName(line);
		if (headerName) {
			if (headerName === currentHeader) {
				skip = false;
				outputLines.push(line);
			} else if (parents.includes(headerName)) {
				skip = true;
			} else {
				// Unknown header (maybe user custom comment or unregistered parent), keep it
				skip = false;
				outputLines.push(line);
			}
		} else {
			if (!skip) {
				outputLines.push(line);
			}
		}
	}

	let cleaned = outputLines.join("\n");

	// Ensure JSONC ends properly:
	cleaned = removeTrailingComma(cleaned);
	if (!cleaned.trim().endsWith("}")) {
		// If we somehow lost the closing brace or it's malformed
		cleaned = cleaned.trimEnd() + "\n}";
	}

	// Write cleaned file:
	await fs.writeFile(settingsPath, cleaned, "utf8");
}

/**
 * Writes a set of inherited settings to a settings path.
 *
 * IMPORTANT: This function assumes that there are no inherited settings in the
 * file. Any inherited settings should be removed before calling this function.
 */
export async function writeInheritedSettings(
	settingsPath: string,
	groups: Array<{ name: string; settings: Record<string, string> }>,
	currentProfileName: string,
): Promise<void> {
	// Read the raw file
	let raw = await readRawSettingsFile(settingsPath);
	const tab = findTabValue(raw);

	// 1. Ensure the "Current" header exists for local settings
	const currentHeader = `${tab}// --- ${currentProfileName} (current) --- //`;
	if (!raw.includes(currentHeader.trim())) {
		// Insert it after the opening brace
		const openBraceIndex = raw.indexOf("{");
		if (openBraceIndex !== -1) {
			const beforeBox = raw.slice(0, openBraceIndex + 1);
			const afterBox = raw.slice(openBraceIndex + 1);
			raw = `${beforeBox}\n${currentHeader}${afterBox}`;
		}
	}

	// 2. Append inherited groups
	if (groups.length > 0) {
		const [beforeClose, afterClose] = splitRawSettingsByClosingBrace(raw);

		// Build the inherited settings block:
		const block = buildInheritedSettingsBlock(groups, tab);

		// Insert the inherited settings block between the before and after closing
		// brace blocks:
		const beforeClosePlusBlock = insertBeforeClose(beforeClose, block);
		raw = beforeClosePlusBlock + afterClose;
	}

	// Write the final settings to the settings path:
	await fs.writeFile(settingsPath, raw, "utf8");
}

/**
 * Builds the inherited settings block with start, warning, entries, and end.
 *
 * @param groups Grouped settings to insert into the settings block.
 * @param tab Tab sequence to use.
 * @returns Returns the raw inherited settings block.
 */
function buildInheritedSettingsBlock(
	groups: Array<{ name: string; settings: Record<string, string> }>,
	tab: string,
): string {
	const lines: string[] = [];

	groups.forEach((group, index) => {
		lines.push(`${tab}// --- ${group.name} --- //`);
		const groupEntries = Object.entries(group.settings);
		groupEntries.forEach(([key, value], entryIdx) => {
			const isLastOfAll =
				index === groups.length - 1 && entryIdx === groupEntries.length - 1;
			const suffix = isLastOfAll ? "" : ",";
			lines.push(`${tab}"${key}": ${JSON.stringify(value)}${suffix}`);
		});

		if (index < groups.length - 1) {
			lines.push(""); // Empty line for spacing between groups
		}
	});

	// Only return the content, NO MARKERS
	return (lines.length ? "\n" : "") + lines.join("\n") + "\n";
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

	const config = vscode.workspace.getConfiguration("inheritProfile");
	const parents = config.get<string[]>("parents", []);

	// Remove the inherited settings from the current profile:
	await removeInheritedSettingsFromFile(
		currentProfilePath,
		currentProfileName,
		parents,
	);

	// Get the settings that the current profile should inherit:
	const { byParent, merged } = await getInheritedSettingsByParent(context);
	const totalInheritedSettings = Object.keys(merged).length;

	// Track settings by parent for the report
	Reporter.trackSettingsByParent(byParent);

	// Always call writeInheritedSettings to ensure the local header is added,
	// even if there are no inherited settings.
	// Do NOT reverse here. We want to write blocks in standard order (Base -> Derived)
	// creating a visual flow from generic to specific.
	const hierarchy = [...parents];
	const groups: Array<{ name: string; settings: Record<string, string> }> = [];
	for (const parent of hierarchy) {
		const settings = byParent.get(parent);
		if (settings && Object.keys(settings).length > 0) {
			groups.push({ name: parent, settings });
		}
	}

	if (totalInheritedSettings > 0) {
		Logger.info(
			`Inheriting ${totalInheritedSettings} settings from parents`,
			"Settings",
		);
	} else {
		Logger.info("No new settings to inherit.", "Settings");
	}

	// Add the inherited settings to the end of the profile (and fix local header):
	await writeInheritedSettings(currentProfilePath, groups, currentProfileName);
}
