const inserted: unknown[][] = [];
const execute = jest.fn(async () => []);

jest.mock("next/server", () => ({
	after: () => {
		throw new Error("outside a request scope");
	},
}));
jest.mock("@/lib/database/db", () => ({
	db: {
		insertInto: () => ({
			values: (rows: unknown[]) => {
				inserted.push(rows);
				return { execute };
			},
		}),
	},
}));
jest.mock("@/lib/database/utils", () => ({ invalidateDbReadiness: jest.fn() }));

import {
	flushLogs,
	logError,
	logInfo,
	logWarn,
	serializeMetadata,
} from "./logger";

beforeAll(() => {
	jest.spyOn(console, "log").mockImplementation(() => {});
	jest.spyOn(console, "warn").mockImplementation(() => {});
	jest.spyOn(console, "error").mockImplementation(() => {});
});

beforeEach(async () => {
	await flushLogs();
	inserted.length = 0;
	process.env.DATABASE_URL = "postgres://test";
	delete process.env.LOG_DB_LEVEL;
});

test("batches log calls into one insert", async () => {
	logInfo("one", { source: "test" });
	logWarn("two");
	logError(new Error("three"));
	await flushLogs();
	expect(inserted).toHaveLength(1);
	expect(inserted[0]).toEqual([
		expect.objectContaining({ level: "info", message: "one", source: "test" }),
		expect.objectContaining({ level: "warn", message: "two" }),
		expect.objectContaining({
			level: "error",
			message: "three",
			trace: expect.stringContaining("three"),
		}),
	]);
});

test("keeps error details in metadata", () => {
	const error = Object.assign(new Error("connection refused"), {
		code: "ECONNREFUSED",
	});
	expect(JSON.parse(serializeMetadata({ error, count: BigInt(2) }))).toEqual({
		error: {
			name: "Error",
			message: "connection refused",
			code: "ECONNREFUSED",
		},
		count: "2",
	});
});

test("honours LOG_DB_LEVEL", async () => {
	process.env.LOG_DB_LEVEL = "warn";
	logInfo("skipped");
	logWarn("kept");
	await flushLogs();
	expect(inserted.flat()).toEqual([
		expect.objectContaining({ message: "kept" }),
	]);

	process.env.LOG_DB_LEVEL = "off";
	logError("console only");
	await flushLogs();
	expect(inserted.flat()).toHaveLength(1);
});

test("bounds the queue and reports dropped entries", async () => {
	for (let i = 0; i < 1005; i++) logInfo(`entry ${i}`);
	await flushLogs();
	const rows = inserted.flat() as { message: string }[];
	expect(rows[0].message).toBe("Dropped 5 log entries (queue full)");
	expect(rows).toHaveLength(1001);
	expect(rows.at(-1)?.message).toBe("entry 1004");
});
