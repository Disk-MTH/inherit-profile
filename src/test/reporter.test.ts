import * as assert from "node:assert";
import { Reporter } from "../lib/reporter";

suite("Reporter Test Suite", () => {
	setup(() => {
		Reporter.initialize("TestProfile", ["Parent1", "Parent2"]);
	});

	test("Tracks extensions", () => {
		Reporter.trackExtensionResult("ext.id.1", "added");
		Reporter.trackExtensionResult("ext.id.2", "failed");

		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;

		assert.ok(data.extensions.installed.includes("ext.id.1"));
		assert.ok(data.extensions.failed.includes("ext.id.2"));
	});

	test("Tracks settings", () => {
		const byParent = new Map<string, string[]>();
		byParent.set("Parent1", ["setting.a", "setting.b"]);
		Reporter.trackSettingsByParent(byParent);

		// biome-ignore lint/suspicious/noExplicitAny: Accessing private property for testing
		const data = (Reporter as any).data;
		assert.strictEqual(data.settings.total, 2);
		assert.deepStrictEqual(data.settings.byParent.get("Parent1"), [
			"setting.a",
			"setting.b",
		]);
	});
});
