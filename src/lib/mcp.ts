import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "./logger.js";
import { getCurrentProfileName, getProfileMap } from "./profileDiscovery.js";
import { Reporter } from "./reporter.js";
import { readJSON } from "./utils.js";

interface McpConfig {
	mcpServers?: Record<string, unknown>;
	[key: string]: unknown;
}

export async function syncMcp(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("inheritProfile");
	if (!config.get<boolean>("mcp", true)) {
		return;
	}

	Logger.section("MCP Sync");

	const parentProfiles = config.get<string[]>("parents", []);
	if (parentProfiles.length === 0) {
		return;
	}

	const profileMap = await getProfileMap(context);
	const currentProfileName = await getCurrentProfileName(context);
	const currentProfilePath = profileMap[currentProfileName];

	if (!currentProfilePath) {
		Logger.warn(
			`Current profile path not found for ${currentProfileName}`,
			"MCP",
		);
		return;
	}

	let aggregatedServers: Record<string, unknown> = {};

	// 1. Collect Parent MCP Servers
	for (const parent of parentProfiles) {
		const parentPath = profileMap[parent];
		if (!parentPath) continue;

		const mcpPath = path.join(parentPath, "mcp.json");
		const mcpObj = (await readJSON(mcpPath, true)) as McpConfig;

		if (mcpObj?.mcpServers) {
			const count = Object.keys(mcpObj.mcpServers).length;
			Logger.info(
				`Loaded ${count} MCP servers from parent '${parent}'.`,
				"MCP",
			);
			// Merge: Later parents override earlier ones
			aggregatedServers = { ...aggregatedServers, ...mcpObj.mcpServers };
		}
	}

	if (Object.keys(aggregatedServers).length === 0) {
		Logger.info("No inherited MCP servers found.", "MCP");
		return;
	}

	// 2. Sync with Current Profile
	const currentMcpPath = path.join(currentProfilePath, "mcp.json");

	try {
		// Read current config
		const currentMcpObj = (await readJSON(currentMcpPath, true)) as McpConfig;

		// We want to merge inherited servers into the current config.
		// Strategy: Inherited servers are added. User overrides in current profile take precedence?
		// Or should we mark them as inherited?
		// For settings, we used markers. For tasks, we used __inherited.
		// For MCP, let's assume standard JSON merge where User > Parent.

		// However, if we just merge, we can't distinguish user-added vs inherited later.
		// But unlike tasks/keybindings which are lists, this is a map.
		// So if we merge `aggregatedServers` into `currentServers`, we are fine.
		// But if we want to update (e.g. parent changes URL), we need to overwrite.

		// Strategy:
		// 1. Identify User Defined Servers (those without __inherited flag, OR those that the user explicitly defined/modified).
		// Actually, the user request is: "on peut utiliser diretement la clef du serveur pour faire un ovverride ou non."
		// This means if the key exists in the user's config, we respect it and do NOT overwrite it with the parent's.

		const userServers: Record<string, unknown> = {};
		const existingKeys = new Set<string>();

		if (currentMcpObj?.mcpServers) {
			for (const [key, value] of Object.entries(currentMcpObj.mcpServers)) {
				// If it's not marked as inherited, it's a user server (or a previously synced one that lost the flag? No, we add the flag).
				// But wait, if we synced it before, it HAS the flag.
				// If the user MODIFIED it, did they remove the flag? Probably not.
				// So if we want to allow "User Override", the user must have defined it.
				// If the user defines a server with the same key, it overrides the parent.

				// If we strictly follow "Key exists -> User wins", then we can never update an inherited server if the user hasn't touched it?
				// No, if it was inherited, we WANT to update it.
				// How do we distinguish "User defined" vs "Inherited"?
				// The `__inherited` flag is our only clue.

				if (value && typeof value === "object") {
					if ("__inherited" in value) {
						// It was inherited. We can overwrite it with the new parent version.
						// So we don't add it to `userServers` (which are preserved/protected).
					} else {
						// It is user defined. We keep it and it blocks inheritance for this key.
						userServers[key] = value;
						existingKeys.add(key);
					}
				}
			}
		}

		// Prepare new inherited servers
		const newInheritedServers: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(aggregatedServers)) {
			if (value && typeof value === "object") {
				// Only add if NOT in user servers
				if (!existingKeys.has(key)) {
					newInheritedServers[key] = { ...value, __inherited: true };
					Reporter.trackMcp(key);
				} else {
					Logger.info(
						`MCP Server '${key}' exists in user config. Skipping inheritance.`,
						"MCP",
					);
				}
			}
		}

		// Merge: User servers + New Inherited Servers
		const finalServers = { ...newInheritedServers, ...userServers };

		const output: McpConfig = {
			...currentMcpObj, // Preserve other top-level keys if any
			mcpServers: finalServers,
		};

		await fs.writeFile(currentMcpPath, JSON.stringify(output, null, 4));
		Logger.info(
			`Synced ${Object.keys(newInheritedServers).length} inherited MCP servers.`,
			"MCP",
		);
	} catch (error) {
		Logger.error("Failed to sync MCP servers", error, "MCP");
	}
}
