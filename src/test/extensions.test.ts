import * as assert from "node:assert";
import * as vscode from "vscode";
import { getProfileExtensions, syncExtensions } from "../lib/extensions";
import { Reporter } from "../lib/reporter";
import { TestEnvironment } from "./testUtils";

suite("Extensions Sync Test Suite", () => {
	let env: TestEnvironment;

	setup(async () => {
		env = new TestEnvironment();
		await env.setup();
		Reporter.initialize("Child", []);
	});

	teardown(async () => {
		await env.teardown();
		await vscode.workspace
			.getConfiguration("inheritProfile")
			.update("parents", undefined, vscode.ConfigurationTarget.Global);
	});

	test("Attempts to install missing extensions", async () => {
		// Setup: Parent profile with an extension
		await env.createProfile("Parent", "parent-loc", {}, [
			{ identifier: { id: "fake.extension.id" } },
		]);

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
		await syncExtensions(env.getContext());

		// Verify via Reporter - expect it to fail because the ID is fake
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.ok(
			data.extensions.failed.includes("fake.extension.id") ||
				data.extensions.installed.includes("fake.extension.id"),
			"Should track the extension attempt",
		);
	});

	test("Skips already installed extensions", async () => {
		// The extension "alexthomson.inherit-profile" is already installed (it's under test)
		await env.createProfile("Parent", "parent-loc", {}, [
			{ identifier: { id: "alexthomson.inherit-profile" } },
		]);

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
		await syncExtensions(env.getContext());

		// Verify - should NOT be in installed or failed since it's already present
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.ok(
			!data.extensions.installed.includes("alexthomson.inherit-profile"),
			"Should not add already installed extension",
		);
		assert.ok(
			!data.extensions.failed.includes("alexthomson.inherit-profile"),
			"Should not fail",
		);
	});

	test("Default profile reads from global extensions directory", async () => {
		// Setup: Default profile with extensions in ~/.vscode/extensions/extensions.json
		await env.createDefaultProfile({}, [
			{ identifier: { id: "test.default-ext-1" } },
			{ identifier: { id: "test.default-ext-2" } },
		]);

		await env.setStorageJson([], "Default");

		// Get extensions using the test environment's vscodeExtensionsDir
		const extensions = await getProfileExtensions(
			env.getContext(),
			"Default",
			env.vscodeExtensionsDir,
		);

		// Verify we found the extensions from the global extensions directory
		assert.strictEqual(extensions.length, 2, "Should find 2 extensions");
		assert.ok(
			extensions.includes("test.default-ext-1"),
			"Should include test.default-ext-1",
		);
		assert.ok(
			extensions.includes("test.default-ext-2"),
			"Should include test.default-ext-2",
		);
	});
});
