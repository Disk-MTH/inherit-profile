import * as vscode from "vscode";
import { getCurrentProfileName } from "./profileDiscovery.js";

interface ExtensionData {
	byParent: Map<string, string[]>;
	installed: string[];
	failed: string[];
}

interface SettingsData {
	byParent: Map<string, Record<string, string>>;
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

	trackSettingsByParent(byParent: Map<string, Record<string, string>>) {
		Reporter.data.settings.byParent = byParent;
		let total = 0;
		for (const settings of byParent.values()) {
			total += Object.keys(settings).length;
		}
		Reporter.data.settings.total = total;
	},

	// Legacy methods for backward compatibility with tests
	trackExtension(id: string, status: "added" | "failed") {
		Reporter.trackExtensionResult(id, status);
	},

	trackSettings(count: number, sources: string[]) {
		const byParent = new Map<string, Record<string, string>>();
		for (const source of sources) {
			byParent.set(source, {});
		}
		Reporter.data.settings.total = count;
		Reporter.data.settings.byParent = byParent;
	},

	async showSummary(context: vscode.ExtensionContext) {
		const config = vscode.workspace.getConfiguration("inheritProfile");

		const dateStr = Reporter.data.timestamp
			.toISOString()
			.replace(/[:.]/g, "-")
			.split("T")
			.join("_");
		const filename = `${Reporter.data.profileName}_${dateStr}.md`;
		const storageUri = context.globalStorageUri;

		try {
			await vscode.workspace.fs.createDirectory(storageUri);
		} catch {
			// Ignore if exists
		}

		const reportsUri = vscode.Uri.joinPath(storageUri, "reports");
		try {
			await vscode.workspace.fs.createDirectory(reportsUri);
		} catch {
			// Ignore if exists
		}

		const fileUri = vscode.Uri.joinPath(reportsUri, filename);
		const content = generateMarkdown(Reporter.data);

		// Always write the File to disk (history)
		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content));

		// Show preview ONLY IF config is true
		if (config.get<boolean>("showSummary", false)) {
			await vscode.commands.executeCommand("markdown.showPreview", fileUri);
		}
	},

	async showHistory(context: vscode.ExtensionContext) {
		const currentProfile = await getCurrentProfileName(context);
		const storageUri = context.globalStorageUri;
		const reportsUri = vscode.Uri.joinPath(storageUri, "reports");

		try {
			const files = await vscode.workspace.fs.readDirectory(reportsUri);
			// Filter files starting with profile name
			const profilePrefix = `${currentProfile}_`;
			const reportFiles = files
				.filter(
					([name, type]) =>
						type === vscode.FileType.File &&
						name.startsWith(profilePrefix) &&
						name.endsWith(".md"),
				)
				.map(([name]) => name);

			// Sort by date (descending)
			// Filename format: Profile_YYYY-MM-DD_HH-mm-ss.md, which is naturally sortable
			reportFiles.sort((a, b) => b.localeCompare(a));

			if (reportFiles.length === 0) {
				vscode.window.showInformationMessage(
					`No history found for profile '${currentProfile}'.`,
				);
				return;
			}

			const selected = await vscode.window.showQuickPick(reportFiles, {
				placeHolder: `Select a report for '${currentProfile}' to view`,
			});

			if (selected) {
				const fileUri = vscode.Uri.joinPath(reportsUri, selected);
				await vscode.commands.executeCommand("markdown.showPreview", fileUri);
			}
		} catch {
			vscode.window.showInformationMessage(
				`No reports directory found for '${currentProfile}'.`,
			);
		}
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
			if (!hasExt && !hasSet) {
				return `\`${p}\` (no found)`;
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

			md += "| Extension ID | State |\n";
			md += "| :--- | :--- |\n";
			for (const id of exts) {
				const isInstalled = d.extensions.installed.includes(id);
				const isFailed = d.extensions.failed.includes(id);

				let state = "✅ Present";
				if (isInstalled) {
					state = "📥 Installed";
				} else if (isFailed) {
					state = "❌ Error";
				}
				md += `| \`${id}\` | ${state} |\n`;
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
		if (settings && Object.keys(settings).length > 0) {
			const isChild = profile === d.profileName;
			const label = isChild ? `${profile} (current)` : profile;
			const settingKeys = Object.keys(settings);

			md += "<details>\n";
			md += `<summary>From <strong>"${label}"</strong> - ${settingKeys.length} settings</summary>\n\n`;

			md += "| Key | Value |\n";
			md += "| :--- | :--- |\n";
			for (const [key, value] of Object.entries(settings)) {
				const valueStr = JSON.stringify(value);
				const escapedValue =
					valueStr.length > 50 ? valueStr.slice(0, 50) + "..." : valueStr;
				md += `| \`${key}\` | \`${escapedValue}\` |\n`;
			}
			md += "\n</details>\n\n";

			totalSettings += settingKeys.length;
			if (!isChild) {
				inheritedSettings += settingKeys.length;
			}
		}
	}

	md += `**Summary:** ${totalSettings} settings, ${inheritedSettings} inherited\n\n`;

	md += "---\n\n";
	md += "*Generated by Inherit Profile Extension*\n";

	return md;
}
