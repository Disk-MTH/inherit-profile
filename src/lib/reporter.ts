import * as vscode from "vscode";

interface ExtensionData {
	byParent: Map<string, string[]>;
	installed: string[];
	failed: string[];
}

interface SettingsData {
	byParent: Map<string, string[]>;
	total: number;
}

interface SyncData {
	profileName: string;
	parents: string[];
	extensions: ExtensionData;
	settings: SettingsData;
	timestamp: Date;
}

// biome-ignore lint/complexity/noStaticOnlyClass: Utility class
export class Reporter {
	private static data: SyncData = Reporter.createEmptyData();

	private static createEmptyData(): SyncData {
		return {
			profileName: "Unknown",
			parents: [],
			extensions: {
				byParent: new Map(),
				installed: [],
				failed: [],
			},
			settings: {
				byParent: new Map(),
				total: 0,
			},
			timestamp: new Date(),
		};
	}

	public static initialize(profileName: string, parents: string[]) {
		Reporter.data = Reporter.createEmptyData();
		Reporter.data.profileName = profileName;
		Reporter.data.parents = parents;
		Reporter.data.timestamp = new Date();
	}

	public static trackExtensionsByParent(byParent: Map<string, string[]>) {
		Reporter.data.extensions.byParent = byParent;
	}

	public static trackExtensionResult(
		id: string,
		status: "installed" | "failed" | "added",
	) {
		if (status === "failed") {
			Reporter.data.extensions.failed.push(id);
		} else {
			Reporter.data.extensions.installed.push(id);
		}
	}

	public static trackSettingsByParent(byParent: Map<string, string[]>) {
		Reporter.data.settings.byParent = byParent;
		let total = 0;
		for (const settings of byParent.values()) {
			total += settings.length;
		}
		Reporter.data.settings.total = total;
	}

	// Legacy methods for backward compatibility with tests
	public static trackExtension(id: string, status: "added" | "failed") {
		Reporter.trackExtensionResult(id, status);
	}

	public static trackSettings(count: number, sources: string[]) {
		const byParent = new Map<string, string[]>();
		for (const source of sources) {
			byParent.set(source, []);
		}
		Reporter.data.settings.total = count;
		Reporter.data.settings.byParent = byParent;
	}

	public static async showSummary() {
		const config = vscode.workspace.getConfiguration("inheritProfile");
		if (!config.get<boolean>("showSummary", false)) {
			return;
		}

		const content = Reporter.generateMarkdown();

		const uri = vscode.Uri.parse("untitled:Profile Sync Summary.md");
		const doc = await vscode.workspace.openTextDocument(uri);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), content);
		await vscode.workspace.applyEdit(edit);

		await vscode.commands.executeCommand("markdown.showPreview", uri);
	}

	private static generateMarkdown(): string {
		const d = Reporter.data;
		const time = d.timestamp.toLocaleTimeString();

		let md = "# 📋 Profile Sync Summary\n\n";
		md += "| Profile | Time |\n";
		md += "| :--- | :--- |\n";
		md += `| \`${d.profileName}\` | ${time} |\n\n`;
		md += `**Inheriting from:** ${d.parents.map((p) => `\`${p}\``).join(" → ") || "None"}\n\n`;
		md += "---\n\n";

		// Extensions Section
		md += "## 🧩 Extensions\n\n";

		const hasChanges =
			d.extensions.installed.length > 0 || d.extensions.failed.length > 0;

		if (!hasChanges && d.extensions.byParent.size === 0) {
			md += "✅ All extensions already in sync.\n\n";
		} else {
			// Show by parent
			for (const parent of d.parents) {
				const extensions = d.extensions.byParent.get(parent);
				if (extensions && extensions.length > 0) {
					md += `### From \`${parent}\` (${extensions.length})\n\n`;
					for (const id of extensions) {
						const isInstalled = d.extensions.installed.includes(id);
						const isFailed = d.extensions.failed.includes(id);

						let icon = "✓";
						let note = "";
						if (isInstalled) {
							icon = "✅";
							note = " (installed)";
						} else if (isFailed) {
							icon = "❌";
							note = " (failed)";
						}
						md += `- ${icon} \`${id}\`${note}\n`;
					}
					md += "\n";
				}
			}

			// Summary
			const summaryParts: string[] = [];
			if (d.extensions.installed.length > 0) {
				summaryParts.push(`✅ ${d.extensions.installed.length} installed`);
			}
			if (d.extensions.failed.length > 0) {
				summaryParts.push(`❌ ${d.extensions.failed.length} failed`);
			}
			if (summaryParts.length > 0) {
				md += `**Summary:** ${summaryParts.join(" | ")}\n\n`;
			}
		}

		// Settings Section
		md += "## ⚙️ Settings\n\n";

		if (d.settings.total === 0) {
			md += "✅ All settings already up to date.\n\n";
		} else {
			for (const parent of d.parents) {
				const settings = d.settings.byParent.get(parent);
				if (settings && settings.length > 0) {
					md += `### From \`${parent}\` (${settings.length})\n\n`;
					const displaySettings =
						settings.length > 15 ? settings.slice(0, 15) : settings;
					for (const key of displaySettings) {
						md += `- \`${key}\`\n`;
					}
					if (settings.length > 15) {
						md += `- ... and ${settings.length - 15} more\n`;
					}
					md += "\n";
				}
			}
			md += `**Total:** ${d.settings.total} settings inherited\n\n`;
		}

		md += "---\n\n";
		md += "*Generated by Inherit Profile Extension*\n";

		return md;
	}
}
