import * as vscode from "vscode";
import { updateCurrentProfileInheritance } from "./profiles";

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"inherit-profile.applyInheritanceToCurrentProfile",
			async () => {
				await updateCurrentProfileInheritance(context);
			},
		),
	);
}

export function deactivate() {}
