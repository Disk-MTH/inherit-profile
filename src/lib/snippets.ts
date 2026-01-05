import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as vscode from "vscode";
import { getCurrentProfileName, getProfileMap } from "./profileDiscovery.js";
import { Logger } from "./logger.js";
import { Reporter } from "./reporter.js";

export async function syncSnippets(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("inheritProfile");
	if (!config.get<boolean>("snippets", true)) {
		return;
	}

	Logger.section("Snippets Sync");

	const parentProfiles = config.get<string[]>("parents", []);
	if (parentProfiles.length === 0) {
		return;
	}

	const profileMap = await getProfileMap(context);
	const currentProfileName = await getCurrentProfileName(context);
	const currentProfilePath = profileMap[currentProfileName];

	if (!currentProfilePath) {
		return;
	}

	const currentSnippetsDir = path.join(currentProfilePath, "snippets");
	
	// Ensure snippets directory exists
	try {
		await fs.mkdir(currentSnippetsDir, { recursive: true });
	} catch (e) {
		// ignore
	}

	for (const parent of parentProfiles) {
		const parentPath = profileMap[parent];
		if (!parentPath) continue;

		const parentSnippetsDir = path.join(parentPath, "snippets");
		
		try {
			const files = await fs.readdir(parentSnippetsDir);
			for (const file of files) {
				if (file.endsWith(".json") || file.endsWith(".code-snippets")) {
					const src = path.join(parentSnippetsDir, file);
					const dest = path.join(currentSnippetsDir, file);
					
					// Check if file exists in destination (User override)
					// Strategy: If user has the same file, we DO NOT overwrite it.
					// The user requested: "si il y en a un du meme nom dans l'enfant que dans le parent ca le sync juste pas"
					
					try {
						await fs.access(dest);
						// File exists, skip
						Logger.info(`Snippet '${file}' exists in current profile. Skipping inheritance.`, "Snippets");
						continue;
					} catch {
						// File does not exist, copy it
						await fs.copyFile(src, dest);
						Logger.info(`Synced snippet file '${file}'.`, "Snippets");
						Reporter.trackSnippet(file);
					}
				}
			}
		} catch (error) {
			// Parent might not have snippets folder
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				Logger.error(`Failed to sync snippets from ${parent}`, error, "Snippets");
			}
		}
	}
}
