import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { syncMcp } from "../lib/mcp";
import { Reporter } from "../lib/reporter";
import { TestEnvironment } from "./testUtils";

suite("MCP Sync Test Suite", () => {
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

	test("Inherits MCP servers", async () => {
		// Setup: Parent
		await env.createProfile("Parent", "parent-loc", {}, [], {
			mcpServers: {
				server1: { command: "cmd1" },
			},
		});

		// Setup: Child (Empty)
		await env.createProfile("Child", "child-loc", {}, [], {
			mcpServers: {},
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
		await syncMcp(env.getContext());

		// Verify
		const childMcpPath = path.join(env.profilesDir, "child-loc", "mcp.json");
		const content = JSON.parse(await fs.readFile(childMcpPath, "utf8"));

		assert.ok(content.mcpServers.server1, "Should inherit server1");
		assert.strictEqual(content.mcpServers.server1.command, "cmd1");
		assert.strictEqual(
			content.mcpServers.server1.__inherited,
			true,
			"Should be marked as inherited",
		);
	});

	test("User override prevents inheritance", async () => {
		// Setup: Parent
		await env.createProfile("Parent", "parent-loc", {}, [], {
			mcpServers: {
				server1: { command: "parent-cmd" },
			},
		});

		// Setup: Child (Override)
		await env.createProfile("Child", "child-loc", {}, [], {
			mcpServers: {
				server1: { command: "child-cmd" },
			},
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
		await syncMcp(env.getContext());

		// Verify
		const childMcpPath = path.join(env.profilesDir, "child-loc", "mcp.json");
		const content = JSON.parse(await fs.readFile(childMcpPath, "utf8"));

		assert.strictEqual(
			content.mcpServers.server1.command,
			"child-cmd",
			"Should keep child command",
		);
		assert.strictEqual(
			content.mcpServers.server1.__inherited,
			undefined,
			"Should NOT be marked as inherited",
		);
	});
});
