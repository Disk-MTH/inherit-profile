import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

function getTimestamp(): string {
	return new Date().toLocaleTimeString();
}

export const Logger = {
	initialize(context: vscode.ExtensionContext) {
		channel = vscode.window.createOutputChannel("Inherit Profile");
		context.subscriptions.push(channel);
	},

	info(message: string, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const log = `[INFO ${getTimestamp()}] ${prefix}${message}`;
		console.info(log);
		channel?.appendLine(log);
	},

	warn(message: string, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const log = `[WARN ${getTimestamp()}] ${prefix}${message}`;
		console.warn(log);
		channel?.appendLine(log);
	},

	error(message: string, error?: unknown, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const errorMsg = error instanceof Error ? error.message : String(error);
		const log = `[ERROR ${getTimestamp()}] ${prefix}${message} ${errorMsg}`;
		console.error(log);
		channel?.appendLine(log);
	},
};
