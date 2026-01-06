import * as vscode from "vscode";
import { Reporter } from "./lib/reporter";
import { updateCurrentProfileInheritance } from "./profiles";

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"inherit-profile.applyInheritance",
			async () => {
				await updateCurrentProfileInheritance(context);
			},
		),
		vscode.commands.registerCommand(
			"inherit-profile.showReportHistory",
			async () => {
				await Reporter.showHistory(context);
			},
		),
	);
}

export function deactivate() {}
