import * as vscode from "vscode";

// biome-ignore lint/complexity/noStaticOnlyClass: Logger is used as a namespace
export class Logger {
	private static channel: vscode.OutputChannel;

	public static initialize(context: vscode.ExtensionContext) {
		Logger.channel = vscode.window.createOutputChannel("Inherit Profile");
		context.subscriptions.push(Logger.channel);
	}

	private static getTimestamp(): string {
		return new Date().toLocaleTimeString();
	}

	public static info(message: string, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const log = `[INFO ${Logger.getTimestamp()}] ${prefix}${message}`;
		console.info(log);
		Logger.channel.appendLine(log);
	}

	public static warn(message: string, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const log = `[WARN ${Logger.getTimestamp()}] ${prefix}${message}`;
		console.warn(log);
		Logger.channel.appendLine(log);
	}

	public static error(message: string, error?: unknown, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const errorMsg = error instanceof Error ? error.message : String(error);
		const log = `[ERROR ${Logger.getTimestamp()}] ${prefix}${message} ${errorMsg}`;
		console.error(log);
		Logger.channel.appendLine(log);
	}

	public static section(title: string) {
		const line = "-".repeat(50);
		Logger.channel.appendLine("");
		Logger.channel.appendLine(line);
		Logger.channel.appendLine(` ${title.toUpperCase()}`);
		Logger.channel.appendLine(line);
	}
}
