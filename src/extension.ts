import * as vscode from "vscode";
import {
	removeCurrentProfileInheritedSettings,
	updateCurrentProfileInheritance,
} from "./profiles";

export async function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"inherit-profile.applyInheritanceToCurrentProfile",
			async () => {
				await updateCurrentProfileInheritance(context);
			},
		),
	);
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"inherit-profile.removeInheritedSettingsFromCurrentProfile",
			async () => {
				await removeCurrentProfileInheritedSettings(context);
			},
		),
	);
}

export function deactivate() {}
