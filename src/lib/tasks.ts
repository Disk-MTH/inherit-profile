import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { Logger } from "./logger.js";
import { getCurrentProfileName, getProfileMap } from "./profileDiscovery.js";
import { Reporter } from "./reporter.js";
import { readJSON } from "./utils.js";

interface Task {
	label: string;
	type: string;
	command?: string;
	[key: string]: unknown;
}

interface TasksFile {
	version: string;
	tasks: Task[];
}

export async function syncTasks(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration("inheritProfile");
	if (!config.get<boolean>("tasks", true)) {
		return;
	}

	Logger.section("Tasks Sync");

	const parentProfiles = config.get<string[]>("parents", []);
	if (parentProfiles.length === 0) {
		return;
	}

	const profileMap = await getProfileMap(context);
	const currentProfileName = await getCurrentProfileName(context);
	const currentProfilePath = profileMap[currentProfileName];

	if (!currentProfilePath) {
		return;
	}

	let aggregatedTasks: Task[] = [];

	// 1. Collect Parent Tasks
	for (const parent of parentProfiles) {
		const parentPath = profileMap[parent];
		if (!parentPath) continue;

		const tasksPath = path.join(parentPath, "tasks.json");
		const tasksObj = (await readJSON(tasksPath, true)) as TasksFile;

		if (tasksObj && Array.isArray(tasksObj.tasks)) {
			Logger.info(
				`Loaded ${tasksObj.tasks.length} tasks from parent '${parent}'.`,
				"Tasks",
			);
			aggregatedTasks = [...aggregatedTasks, ...tasksObj.tasks];
		}
	}

	// 2. Sync with Current Profile
	const currentTasksPath = path.join(currentProfilePath, "tasks.json");

	try {
		const currentTasksObj = (await readJSON(
			currentTasksPath,
			true,
		)) as TasksFile;
		const userTasks =
			currentTasksObj && Array.isArray(currentTasksObj.tasks)
				? // biome-ignore lint/suspicious/noExplicitAny: Task object structure is dynamic
					currentTasksObj.tasks.filter((t: any) => !t.__inherited)
				: [];

		const newInheritedTasks = aggregatedTasks.map((t) => ({
			...t,
			__inherited: true,
		}));

		const finalTasks = [...newInheritedTasks, ...userTasks];

		const output: TasksFile = {
			version: currentTasksObj?.version || "2.0.0",
			tasks: finalTasks,
		};

		await fs.writeFile(currentTasksPath, JSON.stringify(output, null, 4));
		Logger.info(`Synced ${newInheritedTasks.length} inherited tasks.`, "Tasks");
		Reporter.trackTasks(newInheritedTasks.length);
	} catch (error) {
		Logger.error("Failed to sync tasks", error, "Tasks");
	}
}
