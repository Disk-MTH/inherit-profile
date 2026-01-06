import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { Reporter } from "../lib/reporter";
import { syncTasks } from "../lib/tasks";
import { TestEnvironment } from "./testUtils";

suite("Tasks Sync Test Suite", () => {
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

	test("Inherits tasks", async () => {
		// Setup: Parent
		await env.createProfile(
			"Parent",
			"parent-loc",
			{},
			[],
			{},
			{
				version: "2.0.0",
				tasks: [
					{ label: "Parent Task", type: "shell", command: "echo parent" },
				],
			},
		);

		// Setup: Child
		await env.createProfile(
			"Child",
			"child-loc",
			{},
			[],
			{},
			{
				version: "2.0.0",
				tasks: [{ label: "Child Task", type: "shell", command: "echo child" }],
			},
		);

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
		await syncTasks(env.getContext());

		// Verify
		const childTasksPath = path.join(
			env.profilesDir,
			"child-loc",
			"tasks.json",
		);
		const content = JSON.parse(await fs.readFile(childTasksPath, "utf8"));

		const tasks = content.tasks;
		assert.strictEqual(tasks.length, 2, "Should have 2 tasks");

		// biome-ignore lint/suspicious/noExplicitAny: Test data
		const parentTask = tasks.find((t: any) => t.label === "Parent Task");
		assert.ok(parentTask, "Should have Parent Task");
		assert.strictEqual(
			parentTask.__inherited,
			true,
			"Parent Task should be inherited",
		);

		// biome-ignore lint/suspicious/noExplicitAny: Test data
		const childTask = tasks.find((t: any) => t.label === "Child Task");
		assert.ok(childTask, "Should have Child Task");
		assert.strictEqual(
			childTask.__inherited,
			undefined,
			"Child Task should NOT be inherited",
		);
	});
});
