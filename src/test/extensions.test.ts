import * as assert from "node:assert";
import * as vscode from "vscode";
import { syncExtensions } from "../lib/extensions";
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

		// Verify via Reporter
		// We expect it to fail because the ID is fake, but it should be tracked.
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.ok(
			data.extensions.failed.includes("fake.extension.id") ||
				data.extensions.added.includes("fake.extension.id"),
			"Should track the extension attempt (likely failed)",
		);
	});

	test("Skips already installed extensions", async () => {
		// We can't easily mock installed extensions, but we can check logic.
		// If we use the ID of the extension under test (inherit-profile), it is installed.
		// The ID is "alexthomson.inherit-profile" (from package.json).

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

		// Verify
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.strictEqual(
			data.extensions.added.length,
			0,
			"Should not add already installed extension",
		);
		assert.strictEqual(data.extensions.failed.length, 0, "Should not fail");
	});
});
