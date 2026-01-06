import * as vscode from "vscode";

interface SyncData {
	profileName: string;
	parents: string[];
	extensions: { added: string[]; failed: string[] };
	settings: { inherited: number; sources: string[] };
	keybindings: { inherited: number };
	tasks: { inherited: number };
	snippets: { files: string[] };
	mcp: { servers: string[] };
	timestamp: Date;
}

// biome-ignore lint/complexity/noStaticOnlyClass: Utility class
export class Reporter {
	private static data: SyncData = Reporter.createEmptyData();

	private static createEmptyData(): SyncData {
		return {
			profileName: "Unknown",
			parents: [],
			extensions: { added: [], failed: [] },
			settings: { inherited: 0, sources: [] },
			keybindings: { inherited: 0 },
			tasks: { inherited: 0 },
			snippets: { files: [] },
			mcp: { servers: [] },
			timestamp: new Date(),
		};
	}

	public static initialize(profileName: string, parents: string[]) {
		Reporter.data = Reporter.createEmptyData();
		Reporter.data.profileName = profileName;
		Reporter.data.parents = parents;
		Reporter.data.timestamp = new Date();
	}

	public static trackExtension(id: string, status: "added" | "failed") {
		if (status === "added") Reporter.data.extensions.added.push(id);
		else Reporter.data.extensions.failed.push(id);
	}

	public static trackSettings(count: number, sources: string[]) {
		Reporter.data.settings.inherited = count;
		Reporter.data.settings.sources = sources;
	}

	public static trackKeybindings(count: number) {
		Reporter.data.keybindings.inherited = count;
	}

	public static trackTasks(count: number) {
		Reporter.data.tasks.inherited = count;
	}

	public static trackSnippet(file: string) {
		Reporter.data.snippets.files.push(file);
	}

	public static trackMcp(serverName: string) {
		Reporter.data.mcp.servers.push(serverName);
	}

	public static async showSummary() {
		const config = vscode.workspace.getConfiguration("inheritProfile");
		if (!config.get<boolean>("showSummary", false)) {
			return;
		}

		const content = Reporter.generateMarkdown();

		// Strategy: Use `vscode.workspace.openTextDocument` but DO NOT `showTextDocument`.
		// Then run `markdown.showPreview`.

		const uri = vscode.Uri.parse(`untitled:Profile Sync Summary.md`);
		const doc = await vscode.workspace.openTextDocument(uri);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), content);
		await vscode.workspace.applyEdit(edit);

		// Show the markdown preview directly
		await vscode.commands.executeCommand("markdown.showPreview", uri);
	}

	private static generateMarkdown(): string {
		const d = Reporter.data;
		const time = d.timestamp.toLocaleTimeString();

		let md = `# Profile Sync Summary\n\n`;
		md += `**Profile:** \`${d.profileName}\` &nbsp;|&nbsp; **Time:** ${time}\n\n`;
		md += `**Parents:** ${d.parents.map((p) => `\`${p}\``).join(", ") || "None"}\n\n`;
		md += `---\n\n`;

		// Extensions
		md += `## Extensions\n\n`;
		if (d.extensions.added.length === 0 && d.extensions.failed.length === 0) {
			md += `_No changes._\n\n`;
		} else {
			if (d.extensions.added.length > 0) {
				md += `### Installed (${d.extensions.added.length})\n\n`;
				md += `| Extension | Status |\n`;
				md += `| :--- | :--- |\n`;
				d.extensions.added.forEach((id) => {
					md += `| [${id}](command:extension.open?${encodeURIComponent(JSON.stringify([id]))}) | ✅ Installed |\n`;
				});
				md += "\n";
			}
			if (d.extensions.failed.length > 0) {
				md += `### Failed (${d.extensions.failed.length})\n\n`;
				d.extensions.failed.forEach((id) => {
					md += `- ❌ ${id}\n`;
				});
				md += "\n";
			}
		}

		// Settings
		md += `## Settings\n\n`;
		md += `**Inherited:** ${d.settings.inherited} settings\n\n`;
		if (d.settings.sources.length > 0) {
			md += `_Sources: ${d.settings.sources.join(", ")}_\n\n`;
		}
		md += `[Open Settings (UI)](command:workbench.action.openSettings) &nbsp;|&nbsp; [Open Settings (JSON)](command:workbench.action.openSettingsJson)\n\n`;

		// Keybindings
		md += `## Keybindings\n\n`;
		md += `**Inherited:** ${d.keybindings.inherited} keybindings\n\n`;
		md += `[Open Keybindings](command:workbench.action.openGlobalKeybindings)\n\n`;

		// Tasks
		md += `## Tasks\n\n`;
		md += `**Inherited:** ${d.tasks.inherited} tasks\n\n`;
		md += `[Open User Tasks](command:workbench.action.tasks.openUserTasks)\n\n`;

		// MCP Servers
		md += `## MCP Servers\n\n`;
		if (d.mcp.servers.length === 0) {
			md += `_No MCP servers synced._\n\n`;
		} else {
			md += `| Server | Status |\n`;
			md += `| :--- | :--- |\n`;
			d.mcp.servers.forEach((s) => {
				md += `| **${s}** | ✅ Synced |\n`;
			});
			md += "\n";
		}
		md += `[Open MCP Config](command:workbench.mcp.openUserMcpJson)\n\n`;

		// Snippets
		md += `## Snippets\n\n`;
		if (d.snippets.files.length === 0) {
			md += `_No snippets synced._\n\n`;
		} else {
			md += `| File | Status |\n`;
			md += `| :--- | :--- |\n`;
			d.snippets.files.forEach((f) => {
				md += `| \`${f}\` | ✅ Synced |\n`;
			});
			md += "\n";
		}
		md += `[Open Snippets](command:workbench.action.openSnippets)\n\n`;

		md += `---\n`;
		md += `*Generated by Inherit Profile Extension*`;

		return md;
	}
}
