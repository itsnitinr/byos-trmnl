import { after } from "next/server";
import { db } from "@/lib/database/db";
import { invalidateDbReadiness } from "@/lib/database/utils";

export type LogLevel = "info" | "warn" | "error" | "debug";

interface LogOptions {
	source?: string;
	metadata?: Record<string, unknown>;
	trace?: string;
}

type SystemLogRow = {
	level: LogLevel;
	message: string;
	source: string | null;
	metadata: string | null;
	trace: string | null;
};

const LEVEL_RANK: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};
const MAX_QUEUE = 1000;
const MAX_BATCH = 200;
const FLUSH_DELAY_MS = 250;
const MAX_METADATA_CHARS = 16_000;

/**
 * Minimum level persisted to `system_logs` (`LOG_DB_LEVEL`, default `info`).
 * `off` keeps logs on the console only. Console output is never filtered here.
 */
function persistThreshold(): number | null {
	const configured = process.env.LOG_DB_LEVEL?.toLowerCase() ?? "info";
	if (configured === "off" || configured === "none") return null;
	return LEVEL_RANK[configured as LogLevel] ?? LEVEL_RANK.info;
}

/** JSON that keeps Error details (JSON.stringify turns an Error into `{}`). */
export function serializeMetadata(metadata: Record<string, unknown>): string {
	const json = JSON.stringify(metadata, (_key, value) => {
		if (value instanceof Error) {
			return {
				name: value.name,
				message: value.message,
				...("code" in value ? { code: value.code } : {}),
			};
		}
		if (typeof value === "bigint") return value.toString();
		return value;
	});
	return json.length > MAX_METADATA_CHARS
		? JSON.stringify({ truncated: true, preview: json.slice(0, 2000) })
		: json;
}

type QueueState = {
	rows: SystemLogRow[];
	dropped: number;
	scheduled: boolean;
	flushing: Promise<void> | null;
	lastFailureLog: number;
};
const globalState = globalThis as typeof globalThis & {
	byosLogQueue?: QueueState;
};
globalState.byosLogQueue ??= {
	rows: [],
	dropped: 0,
	scheduled: false,
	flushing: null,
	lastFailureLog: 0,
};
const queue = globalState.byosLogQueue;

async function writeBatch(rows: SystemLogRow[]): Promise<void> {
	try {
		await db.insertInto("system_logs").values(rows).execute();
	} catch (error) {
		invalidateDbReadiness();
		// One line per minute is enough to notice; per-row errors would flood.
		if (Date.now() - queue.lastFailureLog > 60_000) {
			queue.lastFailureLog = Date.now();
			console.error(
				`Error writing ${rows.length} row(s) to system_logs:`,
				error instanceof Error ? error.message : error,
			);
		}
	}
}

/** Write everything queued so far. Safe to call concurrently. */
export async function flushLogs(): Promise<void> {
	while (queue.flushing) await queue.flushing;
	if (queue.rows.length === 0) return;
	queue.flushing = (async () => {
		try {
			while (queue.rows.length > 0) {
				if (queue.dropped > 0) {
					queue.rows.unshift({
						level: "warn",
						message: `Dropped ${queue.dropped} log entries (queue full)`,
						source: "logger",
						metadata: null,
						trace: null,
					});
					queue.dropped = 0;
				}
				await writeBatch(queue.rows.splice(0, MAX_BATCH));
			}
		} finally {
			queue.flushing = null;
		}
	})();
	await queue.flushing;
}

/**
 * Flush after the current response when there is one (one INSERT per request
 * instead of one per log call), otherwise shortly on a timer.
 */
function scheduleFlush(): void {
	if (queue.scheduled) return;
	queue.scheduled = true;
	const run = async () => {
		queue.scheduled = false;
		await flushLogs();
	};
	try {
		after(run);
	} catch {
		setTimeout(() => void run(), FLUSH_DELAY_MS).unref?.();
	}
}

function enqueue(row: SystemLogRow): void {
	if (queue.rows.length >= MAX_QUEUE) {
		queue.rows.shift();
		queue.dropped++;
	}
	queue.rows.push(row);
	scheduleFlush();
}

export const log = async (
	level: LogLevel,
	message: string | Error,
	options: LogOptions = {},
): Promise<void> => {
	const messageText = message instanceof Error ? message.message : message;
	const trace = message instanceof Error ? message.stack : options.trace;

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

	const threshold = persistThreshold();
	if (!process.env.DATABASE_URL || threshold === null) return;
	if (LEVEL_RANK[level] < threshold) return;

	let metadata: string | null = null;
	if (options.metadata) {
		try {
			metadata = serializeMetadata(options.metadata);
		} catch {
			metadata = JSON.stringify({ unserializable: true });
		}
	}
	enqueue({
		level,
		message: messageText,
		source: options.source || null,
		metadata,
		trace: trace || null,
	});
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
