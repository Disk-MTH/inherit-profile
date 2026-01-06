import * as fs from "node:fs/promises";
import { parse } from "jsonc-parser";
import { Logger } from "./logger";

/**
 * Reads JSONC (JSON with comments).
 * @param filePath Path to the JSON/JSONC file.
 * @param silent If true, suppresses error logging.
 * @returns Parsed object or {} on error.
 */
export async function readJSON(
	filePath: string,
	silent = false,
): Promise<unknown> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return parse(raw); // handles // and /* */ comments
	} catch (error) {
		if (!silent) {
			Logger.error(
				`Failed to read JSONC at ${filePath}:`,
				error as Error,
				"Utils",
			);
		}
		return {};
	}
}

/**
 * Finds a record by a key value pair within the record.
 * @param obj Object to search.
 * @param key Key to search.
 * @param value Expected value of the key.
 * @returns Returns the record with the given ID.
 */
export function findByKeyValuePair(
	input: unknown,
	key: string,
	value: unknown,
): unknown | undefined {
	const seen = new Set<object>();

	function dfs(node: unknown): unknown | undefined {
		if (node === null || typeof node !== "object") {
			return undefined;
		}
		if (seen.has(node as object)) {
			return undefined;
		}
		seen.add(node as object);

		if (!Array.isArray(node)) {
			if (
				Object.hasOwn(node, key) &&
				(node as Record<string, unknown>)[key] === value
			) {
				return node;
			}
			for (const v of Object.values(node as Record<string, unknown>)) {
				const found = dfs(v);
				if (found) {
					return found;
				}
			}
		} else {
			for (const item of node as unknown[]) {
				const found = dfs(item);
				if (found) {
					return found;
				}
			}
		}

		return undefined;
	}

	return dfs(input);
}

/**
 * Recursively flattens settings into a single record that maps the setting key
 * to its value.
 * @param settings Settings to flatten.
 * @param parentKey Parent key from previous iteration.
 * @param result Flattened result to return.
 * @returns Returns the flattened result.
 */
export function flattenSettings(
	settings: Record<string, unknown>,
	parentKey = "",
	result: Record<string, unknown> = {},
): Record<string, unknown> {
	for (const [key, value] of Object.entries(settings)) {
		const newKey = parentKey ? `${parentKey}.${key}` : key;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			flattenSettings(value as Record<string, unknown>, newKey, result);
		} else {
			result[newKey] = value;
		}
	}
	return result;
}

/**
 * Merges two flattened settings objects into one.
 * Keys from `source` override keys from `target`.
 *
 * Example:
 * target = { "editor.fontSize": "14", "files.autoSave": "off" }
 * source = { "editor.fontSize": "16" }
 *
 * result = { "editor.fontSize": "16", "files.autoSave": "off" }
 */
export function mergeFlattenedSettings(
	target: Record<string, string>,
	source: Record<string, string>,
): Record<string, string> {
	return { ...target, ...source };
}

/**
 * Sorts a given set of `settings` alphabetically (A to Z).
 * @param settings Settings to sort alphabetically.
 * @returns Returns the `settings`, but sorted alphabetically (A to Z).
 */
export function sortSettings(
	settings: Record<string, string>,
): Record<string, string> {
	return Object.keys(settings)
		.sort((a, b) => a.localeCompare(b))
		.reduce<Record<string, string>>((acc, key) => {
			acc[key] = settings[key];
			return acc;
		}, {});
}

/**
 * Removes the last trailing comma from a JSONC (JSON with Comments) string.
 * It correctly handles single-line, multi-line, and comments within strings.
 * A trailing comma is defined as a comma that is the last meaningful character,
 * or a comma that is the second-to-last meaningful character followed only by a
 * closing brace '}' or bracket ']'.
 *
 * @param text The JSONC content as a string.
 * @returns A new string with the trailing comma removed, or the original string if no trailing comma was found.
 */
export function removeTrailingComma(text: string): string {
	let lastMeaningfulIndex = -1;
	let secondToLastMeaningfulIndex = -1;

	let inMultiLineComment = false;
	let inString = false;
	let stringChar = ""; // Can be ' or "

	// This loop is similar to getLastMeaningfulCharacterIndex, but tracks the last TWO meaningful characters.
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const prevChar = text[i - 1];
		const nextChar = text[i + 1];

		// State 1: Inside a multi-line comment
		if (inMultiLineComment) {
			if (char === "*" && nextChar === "/") {
				inMultiLineComment = false;
				i++; // Consume the '/'
			}
			continue;
		}

		// State 2: Inside a string
		if (inString) {
			if (char === stringChar && prevChar !== "\\") {
				inString = false;
			}
			secondToLastMeaningfulIndex = lastMeaningfulIndex;
			lastMeaningfulIndex = i;
			continue;
		}

		// State 3: Default state (not in a comment or string)
		if (char === "/" && nextChar === "/") {
			const newlineIndex = text.indexOf("\n", i);
			if (newlineIndex === -1) {
				break; // End of file is a comment
			}
			i = newlineIndex;
			continue;
		}

		if (char === "/" && nextChar === "*") {
			inMultiLineComment = true;
			i++; // Consume the '*'
			continue;
		}

		if (char === '"' || char === "'") {
			inString = true;
			stringChar = char;
			secondToLastMeaningfulIndex = lastMeaningfulIndex;
			lastMeaningfulIndex = i;
			continue;
		}

		if (!/\s/.test(char)) {
			secondToLastMeaningfulIndex = lastMeaningfulIndex;
			lastMeaningfulIndex = i;
		}
	}

	// After parsing, check if we found a trailing comma.
	if (lastMeaningfulIndex === -1) {
		return text; // No meaningful characters found.
	}

	const lastMeaningfulChar = text[lastMeaningfulIndex];

	// Case 1: The very last meaningful character is a comma.
	// e.g., { "a": 1, }
	if (lastMeaningfulChar === ",") {
		return (
			text.slice(0, lastMeaningfulIndex) + text.slice(lastMeaningfulIndex + 1)
		);
	}

	// Case 2: The last character is a brace/bracket, and the one before it is a comma.
	// e.g. { "a": 1, }
	if (
		(lastMeaningfulChar === "}" || lastMeaningfulChar === "]") &&
		secondToLastMeaningfulIndex !== -1
	) {
		const secondToLastMeaningfulChar = text[secondToLastMeaningfulIndex];
		if (secondToLastMeaningfulChar === ",") {
			return (
				text.slice(0, secondToLastMeaningfulIndex) +
				text.slice(secondToLastMeaningfulIndex + 1)
			);
		}
	}

	// If neither of the above conditions are met, there's no trailing comma to remove.
	return text;
}

/**
 * Reads and returns a raw `settings.json` file.
 */
export async function readRawSettingsFile(
	settingsPath: string,
): Promise<string> {
	// Read the raw file:
	// NOTE: This will throw an exception if the file cannot be read.
	return await fs.readFile(settingsPath, "utf8");
}

/**
 * Returns the `raw file in two parts:
 * 1. The content before the closing brace (excluding the closing brace).
 * 2. The content after and including the closing brace.
 *
 * @param raw Raw `settings.json` file.
 * @returns Returns `raw` in two parts: before, and after the closing brace.
 */
export function splitRawSettingsByClosingBrace(
	raw: string,
): [beforeClose: string, afterClose: string] {
	// Split the file by the closing brace:
	const closingIndex = raw.lastIndexOf("}");
	if (closingIndex === -1) {
		return ["{\n", "}\n"];
	}

	const beforeClose = raw.slice(0, closingIndex);
	const afterClose = raw.slice(closingIndex);
	return [beforeClose, afterClose];
}

/**
 * Attempts to detect the tab string used in a JSON/JSONC file.
 * Returns either "\t" for tabs or a string of spaces (usually 2 or 4).
 * Defaults to 4 spaces if detection fails.
 */
export function findTabValue(raw: string): string {
	const lines = raw.split(/\r?\n/);

	for (const line of lines) {
		// Skip empty lines and lines without leading whitespace:
		if (!line.trim()) {
			continue;
		}

		const match = line.match(/^( +|\t+)/);
		if (!match) {
			continue;
		}

		const indent = match[1];
		if (indent[0] === "\t") {
			return "\t"; // Tabs detected
		}

		// Spaces: measure run length
		return " ".repeat(indent.length);
	}

	// Fallback tab size:
	return "    ";
}

/**
 * Inserts block before closing brace, handling commas and trailing comments.
 *
 * Does not remove or modify user comments.
 *
 * @returns Returns a string starting with the `beforeClose` block, followed by
 * the `block`. The returned string is formatted JSONC without the final closing
 * bracket.
 */
export function insertBeforeClose(beforeClose: string, block: string): string {
	// Check last non-comment character:
	const meaningfulCharIndex = getLastMeaningfulCharacterIndex(beforeClose);
	if (meaningfulCharIndex === -1) {
		Logger.warn(
			"No meaningful text found when attempting to insert `block` after `beforeClose`.",
			"Utils",
		);
		return beforeClose.replace(/\s*$/, "\n") + block;
	}
	const meaningfulChar = beforeClose[meaningfulCharIndex];

	// Calculate if we should insert a comma after the last meaningful character
	// index:
	const needsComma =
		/\S/.test(beforeClose) && meaningfulChar !== "{" && meaningfulChar !== ",";

	// Exit early if we do not need to insert a comma:
	if (!needsComma) {
		return beforeClose.replace(/\s*$/, "\n") + block;
	}

	// Insert a comma after the last meaningful character:
	const before = beforeClose.slice(0, meaningfulCharIndex + 1);
	const after = beforeClose.slice(meaningfulCharIndex + 1);

	return `${before},${after.replace(/\s*$/, "\n")}${block}`;
}

/**
 * Finds the index of the last meaningful character in a JSONC (JSON with Comments) string.
 * A "meaningful" character is one that is not part of a single-line or multi-line comment,
 * and is not whitespace. Characters within strings are considered meaningful.
 *
 * @param text The JSONC content as a string.
 * @returns The zero-based index of the last meaningful character, or -1 if none is found.
 */
export function getLastMeaningfulCharacterIndex(text: string): number {
	let lastMeaningfulIndex = -1;
	let inMultiLineComment = false;
	let inString = false;
	let stringChar = ""; // Can be ' or "

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const prevChar = text[i - 1];
		const nextChar = text[i + 1];

		// State 1: Inside a multi-line comment
		if (inMultiLineComment) {
			if (char === "*" && nextChar === "/") {
				inMultiLineComment = false;
				i++; // Consume the '/' as well
			}
			continue;
		}

		// State 2: Inside a string
		if (inString) {
			// Check for the closing quote, ensuring it's not escaped
			if (char === stringChar && prevChar !== "\\") {
				inString = false;
			}
			// All characters inside a string are considered meaningful for this function's purpose.
			lastMeaningfulIndex = i;
			continue;
		}

		// State 3: Default state (not in a comment or string)
		// Check for the start of a single-line comment
		if (char === "/" && nextChar === "/") {
			// Find the next newline character
			const newlineIndex = text.indexOf("\n", i);
			if (newlineIndex === -1) {
				// No more newlines, so the rest of the file is a comment.
				// We can stop processing.
				break;
			}
			// Jump execution to the newline character. The loop's i++ will move to the next line.
			i = newlineIndex;
			continue;
		}

		// Check for the start of a multi-line comment
		if (char === "/" && nextChar === "*") {
			inMultiLineComment = true;
			i++; // Consume the '*' as well
			continue;
		}

		// Check for the start of a string (handles both double and single quotes)
		if (char === '"' || char === "'") {
			inString = true;
			stringChar = char;
			lastMeaningfulIndex = i;
			continue;
		}

		// If we've reached this point, we are in a "normal" code context.
		// A character is meaningful if it's not whitespace.
		if (!/\s/.test(char)) {
			lastMeaningfulIndex = i;
		}
	}

	return lastMeaningfulIndex;
}
