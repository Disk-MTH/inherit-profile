import * as path from "node:path";
import type * as vscode from "vscode";
import { findByKeyValuePair, readJSON } from "./utils.js";

/**
 * @returns The user directory.
 */
export function getUserDirectory(context: vscode.ExtensionContext): string {
	return path.resolve(context.globalStorageUri.fsPath, "../../");
}

/**
 * Gets the path to the global storage JSON file.
 * @param context Extension context.
 * @returns Returns the path to the global storage JSON file.
 */
export function getGlobalStoragePath(context: vscode.ExtensionContext): string {
	return path.resolve(context.globalStorageUri.fsPath, "../storage.json");
}

/**
 * Reads the global storage JSON file.
 *
 * This contains a lot of useful information about profiles.
 * @param context Extension context.
 * @returns Returns the contents of the global storage JSON file.
 */
export async function readGlobalStorage(
	context: vscode.ExtensionContext,
): Promise<unknown> {
	const storagePath: string = getGlobalStoragePath(context);
	return await readJSON(storagePath);
}

/**
 * Extracts the custom profiles section from the global storage JSON file.
 *
 * This is useful for finding out the names and paths of the user created
 * profiles.
 * @param context Extension context.
 * @returns Returns the contents of the `userDataProfiles` filed from the global
 * storage JSON file.
 */
export async function getCustomProfiles(
	context: vscode.ExtensionContext,
): Promise<unknown[]> {
	const storage = await readGlobalStorage(context);
	if (storage && typeof storage === "object" && "userDataProfiles" in storage) {
		return (storage as { userDataProfiles: unknown[] }).userDataProfiles ?? [];
	}
	return [];
}

/**
 * Gets the current profile name.
 * @param context Extension context.
 * @returns Returns the name of the current profile.
 */
export async function getCurrentProfileName(
	context: vscode.ExtensionContext,
): Promise<string> {
	const storage = await readGlobalStorage(context);
	const profilesSubMenu = findByKeyValuePair(
		storage,
		"id",
		"submenuitem.Profiles",
	);
	if (profilesSubMenu) {
		const submenuItems = (
			profilesSubMenu as {
				submenu: { items: { checked: boolean; id: string }[] };
			}
		).submenu.items;
		for (const submenuItem of submenuItems) {
			if (submenuItem.checked) {
				const fullProfileId: string = submenuItem.id;
				const profileId = fullProfileId.substring(
					fullProfileId.lastIndexOf(".") + 1,
				);
				const profileData = findByKeyValuePair(storage, "location", profileId);
				if (profileData) {
					return (profileData as { name: string }).name;
				}
			}
		}
	}
	return "Default";
}

/**
 * Finds each of the profiles in the user directory and returns a mapping from
 * the profile name to the profile directory.
 * @param context Extension context.
 * @returns A mapping from profile name to the directory for the profile.
 */
export async function getProfileMap(
	context: vscode.ExtensionContext,
): Promise<Record<string, string>> {
	const map: Record<string, string> = {};
	const userDirectory = getUserDirectory(context);

	// Add the default profile:
	// NOTE: The default profile always exists in the user directory.
	map.Default = userDirectory;

	// Add the custom profiles:
	const customProfiles = await getCustomProfiles(context);
	for (const profile of customProfiles) {
		const p = profile as { name?: string; location?: string };
		if (p.name && p.location) {
			map[p.name] = path.join(userDirectory, "profiles", p.location);
		}
	}

	return map;
}
