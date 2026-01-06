import * as assert from "node:assert";
import { Reporter } from "../lib/reporter";

suite("Reporter Test Suite", () => {
	setup(() => {
		Reporter.initialize("TestProfile", ["Parent1", "Parent2"]);
	});

	test("Tracks extensions", () => {
		Reporter.trackExtension("ext.id.1", "added");
		Reporter.trackExtension("ext.id.2", "failed");

		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.deepStrictEqual(data.extensions.added, ["ext.id.1"]);
		assert.deepStrictEqual(data.extensions.failed, ["ext.id.2"]);
	});

	test("Tracks settings", () => {
		Reporter.trackSettings(10, ["Parent1"]);
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.strictEqual(data.settings.inherited, 10);
		assert.deepStrictEqual(data.settings.sources, ["Parent1"]);
	});

	test("Tracks MCP servers", () => {
		Reporter.trackMcp("server1");
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.deepStrictEqual(data.mcp.servers, ["server1"]);
	});

	test("Tracks tasks", () => {
		Reporter.trackTasks(5);
		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.strictEqual(data.tasks.inherited, 5);
	});
});
