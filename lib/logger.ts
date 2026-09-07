import { db } from "@/lib/database/db";
import { invalidateDbReadiness } from "@/lib/database/utils";

export type LogLevel = "info" | "warn" | "error" | "debug";

interface LogOptions {
	source?: string;
	metadata?: Record<string, unknown>;
	trace?: string;
}

export const log = async (
	level: LogLevel,
	message: string | Error,
	options: LogOptions = {},
) => {
	// Convert Error objects to strings if necessary
	const messageText = message instanceof Error ? message.message : message;
	const trace = message instanceof Error ? message.stack : options.trace;

	// Always do console logging first
	switch (level) {
		case "info":
			console.log(messageText);
			break;
		case "warn":
			console.warn(messageText);
			break;
		case "error":
			console.error(messageText);
			break;
		case "debug":
			console.debug(messageText);
			break;
	}

	// Callers may await completion when delivery matters. Failures never recurse.
	if (!process.env.DATABASE_URL) return;
	try {
		await db
			.insertInto("system_logs")
			.values({
				level,
				message: messageText,
				source: options.source || null,
				metadata: options.metadata ? JSON.stringify(options.metadata) : null,
				trace: trace || null,
			})
			.execute();
	} catch (err) {
		invalidateDbReadiness();
		console.error("Error writing to system_logs:", err);
	}
};

// Convenience methods
export const logInfo = (message: string, options?: LogOptions) =>
	log("info", message, options);
export const logWarn = (message: string, options?: LogOptions) =>
	log("warn", message, options);
export const logError = (error: Error | string, options?: LogOptions) =>
	log("error", error, options);
export const logDebug = (message: string, options?: LogOptions) =>
	log("debug", message, options);
