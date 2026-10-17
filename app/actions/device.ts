"use server";

import type { ExpressionBuilder } from "kysely";
import { BYOS_MONO_USER_ID, getCurrentUserId } from "@/lib/auth/get-user";
import { db } from "@/lib/database/db";
import type { DB } from "@/lib/database/db.d";
import { containsPattern } from "@/lib/database/like";
import { mapDeviceRow, mapLogRow } from "@/lib/database/mappers";
import { withUserScope } from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";
import {
	createDefaultRefreshSchedule,
	DEFAULT_DEVICE_SCREEN,
	DEFAULT_DEVICE_TIMEZONE,
	DEVICE_SLEEP_REFRESH_SECONDS,
	serializeRefreshSchedule,
} from "@/lib/device/defaults";
import {
	hashClaimCode,
	normalizeClaimCode,
	pendingClaimCutoff,
} from "@/lib/device/pending-device-claims";
import {
	describeValidationError,
	deviceUpdateSchema,
} from "@/lib/device/update-schema";
import type { Device, Log } from "@/lib/types";
import { generateFriendlyId, generateMockMacAddress } from "@/utils/helpers";

/**
 * Fetch a single device by friendly_id
 */
export async function fetchDeviceByFriendlyId(
	friendlyId: string,
): Promise<Device | null> {
	const { ready } = await checkDbConnection();

	if (!ready) {
		console.warn("Database client not initialized");
		return null;
	}

	const device = await withUserScope((scopedDb) =>
		scopedDb
			.selectFrom("devices")
			.selectAll()
			.where("friendly_id", "=", friendlyId)
			.executeTakeFirst(),
	);

	if (!device) {
		return null;
	}

	return mapDeviceRow(device);
}

export type FetchDeviceLogsParams = {
	page: number;
	perPage: number;
	search?: string;
	type?: string;
	friendlyId?: string;
};

export type FetchDeviceLogsResult = {
	logs: Log[];
	total: number;
	uniqueTypes: string[];
};

async function getVisibleDeviceFriendlyIds(
	friendlyId?: string,
): Promise<string[]> {
	const devices = await withUserScope((scopedDb) => {
		let query = scopedDb.selectFrom("devices").select("friendly_id");
		if (friendlyId) {
			query = query.where("friendly_id", "=", friendlyId);
		}
		return query.execute();
	});

	return devices.map((device) => device.friendly_id);
}

/** Classify a device log entry by keywords (the payload is free-form text). */
function logType(logData: string): "error" | "warning" | "info" {
	const text = logData.toLowerCase();
	if (text.includes("error") || text.includes("fail")) return "error";
	if (text.includes("warn")) return "warning";
	return "info";
}

function deviceLogFilters(
	eb: ExpressionBuilder<DB, "logs">,
	friendlyIds: string[],
	search?: string,
	type?: string,
) {
	const isError = eb.or([
		eb("log_data", "ilike", "%error%"),
		eb("log_data", "ilike", "%fail%"),
	]);
	const isWarning = eb("log_data", "ilike", "%warn%");
	const conditions = [eb("friendly_id", "in", friendlyIds)];
	if (search) conditions.push(eb("log_data", "ilike", containsPattern(search)));
	if (type === "error") conditions.push(isError);
	else if (type === "warning") conditions.push(isWarning);
	else if (type === "info")
		conditions.push(eb.and([eb.not(isError), eb.not(isWarning)]));
	return eb.and(conditions);
}

/**
 * Fetch device logs with pagination and filtering. Logs are not under RLS;
 * visibility comes from the caller's (RLS-scoped) devices.
 */
export async function fetchDeviceLogsWithFilters({
	page,
	perPage,
	search,
	type,
	friendlyId,
}: FetchDeviceLogsParams): Promise<FetchDeviceLogsResult> {
	const { ready } = await checkDbConnection();

	if (!ready) {
		console.warn("Database client not initialized");
		return { logs: [], total: 0, uniqueTypes: [] };
	}

	const visibleDeviceIds = await getVisibleDeviceFriendlyIds(friendlyId);
	if (visibleDeviceIds.length === 0) {
		return { logs: [], total: 0, uniqueTypes: [] };
	}

	const limit = Math.min(200, Math.max(1, Math.trunc(perPage) || 1));
	const offset = (Math.max(1, Math.trunc(page) || 1) - 1) * limit;
	const [logs, countResult] = await Promise.all([
		db
			.selectFrom("logs")
			.selectAll()
			.where((eb) => deviceLogFilters(eb, visibleDeviceIds, search, type))
			.orderBy("created_at", "desc")
			.limit(limit)
			.offset(offset)
			.execute(),
		db
			.selectFrom("logs")
			.select((eb) => eb.fn.countAll().as("count"))
			.where((eb) => deviceLogFilters(eb, visibleDeviceIds, search, type))
			.executeTakeFirst(),
	]);

	const logsData = logs.map(mapLogRow);
	return {
		logs: logsData,
		total: Number(countResult?.count || 0),
		// Types present on this page, for the filter dropdown.
		uniqueTypes: Array.from(
			new Set(logsData.map((log) => logType(log.log_data))),
		),
	};
}

/**
 * Update a device. Input is validated and normalized server-side; RLS limits
 * the update to the caller's own devices.
 */
export async function updateDevice(
	device: Partial<Device> & { id: number },
): Promise<{ success: boolean; error?: string }> {
	const { ready } = await checkDbConnection();

	if (!ready) {
		console.warn("Database client not initialized");
		return { success: false, error: "Database client not initialized" };
	}

	const parsed = deviceUpdateSchema.safeParse(device);
	if (!parsed.success) {
		return { success: false, error: describeValidationError(parsed.error) };
	}
	const { id, refresh_schedule, ...fields } = parsed.data;

	const updateData: Record<string, unknown> = {
		...Object.fromEntries(
			Object.entries(fields).filter(([, value]) => value !== undefined),
		),
		updated_at: new Date().toISOString(),
	};
	if (refresh_schedule !== undefined) {
		updateData.refresh_schedule = refresh_schedule
			? serializeRefreshSchedule(refresh_schedule)
			: null;
	}

	try {
		const result = await withUserScope((scopedDb) =>
			scopedDb
				.updateTable("devices")
				.set(updateData)
				.where("id", "=", String(id))
				.executeTakeFirst(),
		);
		if (Number(result.numUpdatedRows) === 0) {
			return { success: false, error: "Device not found" };
		}

		return { success: true };
	} catch (error) {
		console.error("Error updating device:", error);
		return {
			success: false,
			error: friendlyDatabaseError(error),
		};
	}
}

/** Map constraint violations to messages a user can act on. */
function friendlyDatabaseError(error: unknown): string {
	const constraint = (error as { constraint?: string })?.constraint ?? "";
	if (constraint.includes("api_key"))
		return "Another device already uses this API key";
	if (constraint.includes("mac_address"))
		return "Another device already uses this MAC address";
	if (constraint.includes("friendly_id"))
		return "Another device already uses this friendly ID";
	return error instanceof Error ? error.message : String(error);
}

/**
 * Add a new device for the current user.
 * Creates a device record with a placeholder MAC address that will be
 * replaced when the physical device connects via /api/setup.
 */
export async function addUserDevice(input: {
	apiKey: string;
	name?: string;
}): Promise<{
	success: boolean;
	apiKey?: string;
	friendlyId?: string;
	error?: string;
}> {
	const { ready } = await checkDbConnection();
	if (!ready) {
		return { success: false, error: "Database not available" };
	}

	const userId = await getCurrentUserId();
	if (!userId) {
		return { success: false, error: "You must be signed in to add a device" };
	}

	const apiKey = input.apiKey.trim();
	if (!apiKey || apiKey.length < 8) {
		return {
			success: false,
			error: "API key must be at least 8 characters",
		};
	}

	try {
		// Check uniqueness of API key (bypass RLS to check across all users)
		const existing = await db
			.selectFrom("devices")
			.select("id")
			.where("api_key", "=", apiKey)
			.executeTakeFirst();

		if (existing) {
			return {
				success: false,
				error: "A device with this API key already exists",
			};
		}

		// Generate a placeholder MAC from the API key (will be replaced on /api/setup)
		const mockMac = generateMockMacAddress(apiKey);

		const timestamp = new Date().toISOString().replace(/[-:Z]/g, "");
		const friendlyId = generateFriendlyId(mockMac, timestamp);
		const deviceName = input.name?.trim() || `TRMNL Device ${friendlyId}`;

		await withUserScope((scopedDb) =>
			scopedDb
				.insertInto("devices")
				.values({
					mac_address: mockMac,
					name: deviceName,
					friendly_id: friendlyId,
					api_key: apiKey,
					user_id: userId,
					refresh_schedule: serializeRefreshSchedule(
						createDefaultRefreshSchedule(),
					),
					last_update_time: new Date().toISOString(),
					next_expected_update: new Date(
						Date.now() + DEVICE_SLEEP_REFRESH_SECONDS * 1000,
					).toISOString(),
					timezone: DEFAULT_DEVICE_TIMEZONE,
				})
				.execute(),
		);

		return { success: true, apiKey, friendlyId };
	} catch (error) {
		console.error("Error adding device:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Claim a device that is showing a claim code on its /api/display screen.
 */
export async function claimDeviceByCode(input: {
	claimCode: string;
	name?: string;
}): Promise<{
	success: boolean;
	friendlyId?: string;
	error?: string;
}> {
	const { ready } = await checkDbConnection();
	if (!ready) {
		return { success: false, error: "Database not available" };
	}

	const userId = await getCurrentUserId();
	if (!userId) {
		return { success: false, error: "You must be signed in to claim a device" };
	}

	const normalizedClaimCode = normalizeClaimCode(input.claimCode);
	if (normalizedClaimCode.length !== 8) {
		return {
			success: false,
			error: "Claim code must be 8 characters",
		};
	}

	try {
		const claimHash = hashClaimCode(normalizedClaimCode);
		const claimed = await db.transaction().execute(async (trx) => {
			const pendingClaim = await trx
				.deleteFrom("pending_device_claims")
				.where("claim_hash", "=", claimHash)
				.where("last_seen_at", ">", pendingClaimCutoff())
				.returningAll()
				.executeTakeFirst();

			if (!pendingClaim) {
				throw new Error("Claim code was not found or has expired");
			}

			const existingDevice = await trx
				.selectFrom("devices")
				.selectAll()
				.where("api_key", "=", pendingClaim.api_key)
				.executeTakeFirst();

			if (
				existingDevice?.user_id &&
				existingDevice.user_id !== userId &&
				existingDevice.user_id !== BYOS_MONO_USER_ID
			) {
				throw new Error("This device has already been claimed");
			}

			const now = new Date();
			const deviceName = input.name?.trim();
			const macAddress =
				pendingClaim.mac_address ??
				generateMockMacAddress(pendingClaim.api_key);
			const timestamp = now.toISOString().replace(/[-:Z]/g, "");

			if (existingDevice) {
				const friendlyId = existingDevice.friendly_id;
				await trx
					.updateTable("devices")
					.set({
						user_id: userId,
						mac_address: macAddress,
						name: deviceName || existingDevice.name,
						screen: existingDevice.screen ?? DEFAULT_DEVICE_SCREEN,
						model: pendingClaim.model ?? existingDevice.model,
						updated_at: now.toISOString(),
					})
					.where("id", "=", existingDevice.id)
					.execute();
				return { friendlyId };
			}

			const friendlyId = generateFriendlyId(macAddress, timestamp);
			await trx
				.insertInto("devices")
				.values({
					mac_address: macAddress,
					name: deviceName || `TRMNL Device ${friendlyId}`,
					friendly_id: friendlyId,
					api_key: pendingClaim.api_key,
					user_id: userId,
					refresh_schedule: serializeRefreshSchedule(
						createDefaultRefreshSchedule(),
					),
					last_update_time: now.toISOString(),
					next_expected_update: new Date(
						now.getTime() + DEVICE_SLEEP_REFRESH_SECONDS * 1000,
					).toISOString(),
					timezone: DEFAULT_DEVICE_TIMEZONE,
					screen: DEFAULT_DEVICE_SCREEN,
					model: pendingClaim.model,
				})
				.execute();
			return { friendlyId };
		});

		return { success: true, friendlyId: claimed.friendlyId };
	} catch (error) {
		console.error("Error claiming device:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
