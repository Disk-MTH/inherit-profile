import * as vscode from "vscode";

export class Logger {
	private static channel: vscode.OutputChannel;

	public static initialize(context: vscode.ExtensionContext) {
		this.channel = vscode.window.createOutputChannel("Inherit Profile");
		context.subscriptions.push(this.channel);
	}

	private static getTimestamp(): string {
		return new Date().toLocaleTimeString();
	}

	public static info(message: string, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const log = `[INFO ${this.getTimestamp()}] ${prefix}${message}`;
		console.info(log);
		this.channel.appendLine(log);
	}

	public static warn(message: string, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const log = `[WARN ${this.getTimestamp()}] ${prefix}${message}`;
		console.warn(log);
		this.channel.appendLine(log);
	}

	public static error(message: string, error?: unknown, section?: string) {
		const prefix = section ? `[${section}] ` : "";
		const errorMsg = error instanceof Error ? error.message : String(error);
		const log = `[ERROR ${this.getTimestamp()}] ${prefix}${message} ${errorMsg}`;
		console.error(log);
		this.channel.appendLine(log);
	}

	public static section(title: string) {
		const line = "-".repeat(50);
		this.channel.appendLine("");
		this.channel.appendLine(line);
		this.channel.appendLine(` ${title.toUpperCase()}`);
		this.channel.appendLine(line);
	}
}
