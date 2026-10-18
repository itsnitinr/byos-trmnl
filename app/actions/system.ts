"use server";

import type { ExpressionBuilder } from "kysely";
import { auth } from "@/lib/auth/auth";
import { getCurrentUser } from "@/lib/auth/get-user";
import { db } from "@/lib/database/db";
import type { DB } from "@/lib/database/db.d";
import { containsPattern } from "@/lib/database/like";
import { mapSystemLogRow } from "@/lib/database/mappers";
import { checkDbConnection } from "@/lib/database/utils";
import type { SystemLog } from "@/lib/types";

type FetchSystemLogsParams = {
	page: number;
	perPage: number;
	search?: string;
	level?: string;
	source?: string;
};

type FetchSystemLogsResult = {
	logs: SystemLog[];
	total: number;
	uniqueSources: string[];
};

const EMPTY: FetchSystemLogsResult = { logs: [], total: 0, uniqueSources: [] };
const MAX_PER_PAGE = 200;

export async function canReadSystemLogs(): Promise<boolean> {
	if (!auth) {
		return true;
	}

	const user = await getCurrentUser();
	return user?.role === "admin";
}

type Filters = {
	level?: string;
	source?: string;
	search?: string;
	/** Any of these values appearing as a quoted JSON value in metadata. */
	metadataValues?: string[];
};

function applyFilters(eb: ExpressionBuilder<DB, "system_logs">, f: Filters) {
	const conditions = [];
	if (f.level) conditions.push(eb("level", "=", f.level));
	if (f.source) conditions.push(eb("source", "=", f.source));

	if (f.search) {
		const pattern = containsPattern(f.search);
		conditions.push(
			eb.or([
				eb("message", "ilike", pattern),
				eb("metadata", "ilike", pattern),
			]),
		);
	}
	if (f.metadataValues?.length) {
		conditions.push(
			eb.or(
				f.metadataValues.map((value) =>
					eb("metadata", "ilike", containsPattern(`"${value}"`)),
				),
			),
		);
	}
	return eb.and(conditions);
}

async function querySystemLogs(
	page: number,
	perPage: number,
	filters: Filters,
): Promise<FetchSystemLogsResult> {
	const limit = Math.min(MAX_PER_PAGE, Math.max(1, Math.trunc(perPage) || 1));
	const offset = (Math.max(1, Math.trunc(page) || 1) - 1) * limit;

	const [logs, count, sources] = await Promise.all([
		db
			.selectFrom("system_logs")
			.selectAll()
			.where((eb) => applyFilters(eb, filters))
			.orderBy("created_at", "desc")
			.limit(limit)
			.offset(offset)
			.execute(),
		db
			.selectFrom("system_logs")
			.select((eb) => eb.fn.countAll().as("count"))
			.where((eb) => applyFilters(eb, filters))
			.executeTakeFirst(),
		db
			.selectFrom("system_logs")
			.select("source")
			.distinct()
			.orderBy("source", "asc")
			.execute(),
	]);

	return {
		logs: logs.map(mapSystemLogRow),
		total: Number(count?.count || 0),
		uniqueSources: sources
			.map((item) => item.source)
			.filter((source): source is string => Boolean(source)),
	};
}

export async function fetchSystemLogs({
	page,
	perPage,
	search,
	level,
	source,
}: FetchSystemLogsParams): Promise<FetchSystemLogsResult> {
	const { ready } = await checkDbConnection();
	if (!ready) {
		console.warn("Database client not initialized");
		return EMPTY;
	}
	if (!(await canReadSystemLogs())) return EMPTY;

	return querySystemLogs(page, perPage, { search, level, source });
}

/**
 * Fetch system logs that mention a device in their metadata
 */
export type FetchDeviceSystemLogsParams = {
	page: number;
	perPage: number;
	search?: string;
	level?: string;
	source?: string;
	deviceId?: number;
	friendlyId?: string;
	macAddress?: string;
	apiKey?: string;
};

export async function fetchDeviceSystemLogs({
	page,
	perPage,
	search,
	level,
	source,
	friendlyId,
	macAddress,
	apiKey,
}: FetchDeviceSystemLogsParams): Promise<FetchSystemLogsResult> {
	const { ready } = await checkDbConnection();
	if (!ready) {
		console.warn("Database client not initialized");
		return EMPTY;
	}
	if (!(await canReadSystemLogs())) return EMPTY;

	// Routes log the device under different keys (deviceId, device_id,
	// friendly_id), so match the quoted value itself. API keys are only ever
	// logged as their first six characters.
	const metadataValues = [friendlyId, macAddress, apiKey?.slice(0, 6)].filter(
		(value): value is string => Boolean(value),
	);
	if (metadataValues.length === 0) return EMPTY;

	return querySystemLogs(page, perPage, {
		search,
		level,
		source,
		metadataValues,
	});
}
