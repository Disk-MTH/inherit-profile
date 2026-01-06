import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { Reporter } from "../lib/reporter";
import { syncSettings } from "../lib/settings";
import { TestEnvironment } from "./testUtils";

suite("Settings Sync Test Suite", () => {
	let env: TestEnvironment;

	setup(async () => {
		env = new TestEnvironment();
		await env.setup();
		// Reset Reporter
		Reporter.initialize("Child", []);
	});

	teardown(async () => {
		await env.teardown();
		// Reset config
		await vscode.workspace
			.getConfiguration("inheritProfile")
			.update("parents", undefined, vscode.ConfigurationTarget.Global);
	});

	test("Inherits settings from parent profile", async () => {
		// Setup: Parent profile with some settings
		await env.createProfile("Parent", "parent-loc", {
			"editor.fontSize": 20,
			"files.autoSave": "afterDelay",
		});

		// Setup: Child profile (Current)
		await env.createProfile("Child", "child-loc", {
			"editor.fontFamily": "Fira Code",
		});

		// Setup: Storage.json to link profiles
		await env.setStorageJson(
			[
				{ name: "Parent", location: "parent-loc" },
				{ name: "Child", location: "child-loc" },
			],
			"Child",
		);

		// Setup: Config to inherit from Parent
		await vscode.workspace
			.getConfiguration("inheritProfile")
			.update("parents", ["Parent"], vscode.ConfigurationTarget.Global);

		// Execute
		await syncSettings(env.getContext());

		// Verify
		const childSettingsPath = path.join(
			env.profilesDir,
			"child-loc",
			"settings.json",
		);
		const content = await fs.readFile(childSettingsPath, "utf8");
		// const settings = JSON.parse(content); // Note: This might fail if comments are present, but our mock writes pure JSON.
		// Actually, the sync writes comments (markers). So we need to be careful parsing.
		// But we can check if the string contains the expected values.

		assert.ok(
			content.includes('"editor.fontSize": 20'),
			"Should inherit editor.fontSize",
		);
		assert.ok(
			content.includes('"files.autoSave": "afterDelay"'),
			"Should inherit files.autoSave",
		);
		assert.ok(
			content.includes('"editor.fontFamily": "Fira Code"'),
			"Should keep existing editor.fontFamily",
		);
		assert.ok(
			content.includes("INHERITED SETTINGS MARKER START"),
			"Should have markers",
		);
	});

	test("Overridden settings are not overwritten", async () => {
		// Setup: Parent profile
		await env.createProfile("Parent", "parent-loc", {
			"editor.fontSize": 20,
		});

		// Setup: Child profile with override
		await env.createProfile("Child", "child-loc", {
			"editor.fontSize": 14,
		});

		await env.setStorageJson(
			[
				{ name: "Parent", location: "parent-loc" },
				{ name: "Child", location: "child-loc" },
			],
			"Child",
		);

		await vscode.workspace
			.getConfiguration("inheritProfile")
			.update("parents", ["Parent"], vscode.ConfigurationTarget.Global);

		// Execute
		await syncSettings(env.getContext());

		// Verify
		const childSettingsPath = path.join(
			env.profilesDir,
			"child-loc",
			"settings.json",
		);
		const content = await fs.readFile(childSettingsPath, "utf8");

		// It should NOT have inherited editor.fontSize because it's already there.
		// The logic in `getInheritedSettings` subtracts existing settings.

		// However, `applyInheritedSettings` removes old inherited settings first.
		// If "editor.fontSize": 14 was manually added, it stays.

		// We can't easily parse JSONC with comments here without a parser, but string check is fine.
		// We expect "editor.fontSize": 14 to be present (from user).
		// We expect "editor.fontSize": 20 to NOT be present (from parent).

		assert.ok(
			content.includes('"editor.fontSize": 14'),
			"Should keep user override",
		);
		assert.ok(
			!content.includes('"editor.fontSize": 20'),
			"Should not inherit overridden setting",
		);
	});
});
