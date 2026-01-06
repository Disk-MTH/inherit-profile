import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

export interface MockContext extends vscode.ExtensionContext {
	globalStorageUri: vscode.Uri;
}

export class TestEnvironment {
	public rootDir: string;
	public userDir: string;
	public globalStorageDir: string;
	public extensionStorageDir: string;
	public profilesDir: string;

	constructor() {
		this.rootDir = path.join(os.tmpdir(), `inherit-profile-test-${Date.now()}`);
		this.userDir = path.join(this.rootDir, "User");
		this.globalStorageDir = path.join(this.userDir, "globalStorage");
		this.extensionStorageDir = path.join(
			this.globalStorageDir,
			"inherit-profile",
		);
		this.profilesDir = path.join(this.userDir, "profiles");
	}

	public async setup() {
		await fs.mkdir(this.extensionStorageDir, { recursive: true });
		await fs.mkdir(this.profilesDir, { recursive: true });
	}

	public async teardown() {
		await fs.rm(this.rootDir, { recursive: true, force: true });
	}

	public getContext(): MockContext {
		return {
			globalStorageUri: vscode.Uri.file(this.extensionStorageDir),
			// Mock other properties if needed, but mostly we just need globalStorageUri
			subscriptions: [],
			workspaceState: {
				get: () => undefined,
				update: () => Promise.resolve(),
				keys: () => [],
			},
			globalState: {
				get: () => undefined,
				update: () => Promise.resolve(),
				keys: () => [],
				setKeysForSync: () => {},
			},
			extensionUri: vscode.Uri.file(__dirname),
			// biome-ignore lint/suspicious/noExplicitAny: Mocking complex object
			environmentVariableCollection: {} as any,
			extensionMode: vscode.ExtensionMode.Test,
			storageUri: undefined,
			logUri: vscode.Uri.file(path.join(this.rootDir, "log")),
			extension: {
				id: "alexthomson.inherit-profile",
				packageJSON: { version: "0.0.0" },
				extensionPath: __dirname,
				isActive: true,
				exports: undefined,
				activate: () => Promise.resolve(),
				// biome-ignore lint/suspicious/noExplicitAny: Mocking complex object
			} as any,
			asAbsolutePath: (relativePath: string) =>
				path.join(__dirname, relativePath),
			storagePath: undefined,
			globalStoragePath: this.extensionStorageDir,
			logPath: path.join(this.rootDir, "log"),
			// biome-ignore lint/suspicious/noExplicitAny: Mocking complex object
			secrets: {} as any,
			extensionPath: __dirname,
		} as unknown as MockContext;
	}

	public async createProfile(
		_name: string,
		location: string,
		// biome-ignore lint/suspicious/noExplicitAny: Test data
		settings: any = {},
		// biome-ignore lint/suspicious/noExplicitAny: Test data
		extensions: any[] = [],
		// biome-ignore lint/suspicious/noExplicitAny: Test data
		mcp: any = {},
		// biome-ignore lint/suspicious/noExplicitAny: Test data
		tasks: any = {},
		// biome-ignore lint/suspicious/noExplicitAny: Test data
		snippets: any[] = [],
	) {
		const profilePath = path.join(this.profilesDir, location);
		await fs.mkdir(profilePath, { recursive: true });

		if (settings) {
			await fs.writeFile(
				path.join(profilePath, "settings.json"),
				JSON.stringify(settings, null, 4),
			);
		}
		if (extensions) {
			await fs.writeFile(
				path.join(profilePath, "extensions.json"),
				JSON.stringify(extensions, null, 4),
			);
		}
		if (mcp) {
			await fs.writeFile(
				path.join(profilePath, "mcp.json"),
				JSON.stringify(mcp, null, 4),
			);
		}
		if (tasks) {
			await fs.writeFile(
				path.join(profilePath, "tasks.json"),
				JSON.stringify(tasks, null, 4),
			);
		}
		if (snippets && snippets.length > 0) {
			const snippetsDir = path.join(profilePath, "snippets");
			await fs.mkdir(snippetsDir, { recursive: true });
			for (const snippet of snippets) {
				await fs.writeFile(
					path.join(snippetsDir, snippet.name),
					JSON.stringify(snippet.content, null, 4),
				);
			}
		}
		return profilePath;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Test data
	public async createDefaultProfile(settings: any = {}) {
		await fs.writeFile(
			path.join(this.userDir, "settings.json"),
			JSON.stringify(settings, null, 4),
		);
	}

	public async setStorageJson(
		profiles: { name: string; location: string }[],
		currentProfile: string = "Default",
	) {
		const storagePath = path.join(this.globalStorageDir, "storage.json");

		const userDataProfiles = profiles.map((p) => ({
			name: p.name,
			location: p.location,
		}));

		// Mock the structure expected by profileDiscovery.ts
		// It looks for "userDataProfiles" and "submenuitem.Profiles"

		// Construct the submenu items to mock the current profile
		// If currentProfile is "Default", no item is checked? Or Default is checked?
		// The code looks for `submenuitem.id` ending with `.<location>`?
		// No, `profileId = fullProfileId.substring(fullProfileId.lastIndexOf(".") + 1)`
		// And then `findByKeyValuePair(storage, "location", profileId)`

		// If currentProfile is "Default", `getCurrentProfileName` returns "Default" if nothing is found.

		// biome-ignore lint/suspicious/noExplicitAny: Mocking complex object
		const submenuItems: any[] = [];
		if (currentProfile !== "Default") {
			const activeProfile = profiles.find((p) => p.name === currentProfile);
			if (activeProfile) {
				submenuItems.push({
					id: `workbench.menubar.profiles.submenu.${activeProfile.location}`,
					checked: true,
					label: activeProfile.name,
				});
			}
		}

		const storageContent = {
			userDataProfiles: userDataProfiles,
			profileAssociations: {
				workspaces: {},
			},
			// We need to mock the structure that findByKeyValuePair finds.
			// It searches recursively.
			global: {
				"submenuitem.Profiles": {
					id: "submenuitem.Profiles",
					submenu: {
						items: submenuItems,
					},
				},
			},
		};

		await fs.writeFile(storagePath, JSON.stringify(storageContent, null, 4));
	}
}
