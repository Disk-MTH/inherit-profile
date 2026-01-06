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

export const Reporter = {
	data: createEmptyData(),

	initialize(profileName: string, parents: string[]) {
		Reporter.data = createEmptyData();
		Reporter.data.profileName = profileName;
		Reporter.data.parents = parents;
		Reporter.data.timestamp = new Date();
	},

	trackExtensionsByParent(byParent: Map<string, string[]>) {
		Reporter.data.extensions.byParent = byParent;
	},

	trackExtensionResult(id: string, status: "installed" | "failed" | "added") {
		if (status === "failed") {
			Reporter.data.extensions.failed.push(id);
		} else {
			Reporter.data.extensions.installed.push(id);
		}
	},

	trackSettingsByParent(byParent: Map<string, string[]>) {
		Reporter.data.settings.byParent = byParent;
		let total = 0;
		for (const settings of byParent.values()) {
			total += settings.length;
		}
		Reporter.data.settings.total = total;
	},

	// Legacy methods for backward compatibility with tests
	trackExtension(id: string, status: "added" | "failed") {
		Reporter.trackExtensionResult(id, status);
	},

	trackSettings(count: number, sources: string[]) {
		const byParent = new Map<string, string[]>();
		for (const source of sources) {
			byParent.set(source, []);
		}
		Reporter.data.settings.total = count;
		Reporter.data.settings.byParent = byParent;
	},

	async showSummary() {
		const config = vscode.workspace.getConfiguration("inheritProfile");
		if (!config.get<boolean>("showSummary", false)) {
			return;
		}

		const content = generateMarkdown(Reporter.data);

		const uri = vscode.Uri.parse("untitled:Profile Sync Summary.md");
		const doc = await vscode.workspace.openTextDocument(uri);

		const edit = new vscode.WorkspaceEdit();
		edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), content);
		await vscode.workspace.applyEdit(edit);

		await vscode.commands.executeCommand("markdown.showPreview", uri);
	},
};

function createEmptyData(): SyncData {
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

function generateMarkdown(d: SyncData): string {
	const time = d.timestamp.toLocaleString();
	// Hierarchy: Child first, then Last Parent ... First Parent
	const hierarchy = [d.profileName, ...d.parents.slice().reverse()];

	let md = "# 📋 Profile Sync Summary\n\n";

	// Header Table
	const parentsList = d.parents
		.map((p) => {
			const hasExt = d.extensions.byParent.has(p);
			const hasSet = d.settings.byParent.has(p);
			// Assume skipped if no data found in either map
			if (!hasExt && !hasSet) {
				return `\`${p}\` (skipped)`;
			}
			return `\`${p}\``;
		})
		.join(", ");

	md += "| Date | Child (current) | Parents |\n";
	md += "| :--- | :--- | :--- |\n";
	md += `| ${time} | \`${d.profileName}\` | ${parentsList || "None"} |\n\n`;
	md += "---\n\n";

	// Extensions Section
	md += "## 🧩 Extensions\n\n";

	let totalExtensions = 0;
	let inheritedExtensions = 0;
	const newlyInstalledTotal = d.extensions.installed.length;

	for (const profile of hierarchy) {
		const exts = d.extensions.byParent.get(profile);
		if (exts && exts.length > 0) {
			const isChild = profile === d.profileName;
			const label = isChild ? `${profile} (current)` : profile;

			// Count installed for this specific profile source
			const installedFromThis = exts.filter((id) =>
				d.extensions.installed.includes(id),
			).length;
			const installedStr =
				installedFromThis > 0 ? ` (${installedFromThis} installed)` : "";

			md += "<details>\n";
			md += `<summary>From <strong>"${label}"</strong> - ${exts.length} extensions${installedStr}</summary>\n\n`;

			for (const id of exts) {
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
			md += "\n</details>\n\n";

			totalExtensions += exts.length;
			if (!isChild) {
				inheritedExtensions += exts.length;
			}
		}
	}

	const installedSummary =
		newlyInstalledTotal > 0 ? ` (${newlyInstalledTotal} installed)` : "";
	md += `**Summary:** ${totalExtensions} extensions, ${inheritedExtensions} inherited${installedSummary}\n\n`;

	// Settings Section
	md += "## ⚙️ Settings\n\n";

	let totalSettings = 0;
	let inheritedSettings = 0;

	for (const profile of hierarchy) {
		const settings = d.settings.byParent.get(profile);
		if (settings && settings.length > 0) {
			const isChild = profile === d.profileName;
			const label = isChild ? `${profile} (current)` : profile;

			md += "<details>\n";
			md += `<summary>From <strong>"${label}"</strong> - ${settings.length} settings</summary>\n\n`;

			for (const key of settings) {
				md += `- \`${key}\`\n`;
			}
			md += "\n</details>\n\n";

			totalSettings += settings.length;
			if (!isChild) {
				inheritedSettings += settings.length;
			}
		}
	}

	md += `**Summary:** ${totalSettings} settings, ${inheritedSettings} inherited\n\n`;

	md += "---\n\n";
	md += "*Generated by Inherit Profile Extension*\n";

	return md;
}
