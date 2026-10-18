import { db } from "@/lib/database/db";
import { mapPlaylistItemRow } from "@/lib/database/mappers";
import { withExplicitUserScope } from "@/lib/database/scoped-db";
import {
	DISPLAY_FALLBACK_REFRESH_SECONDS,
	normalizeRefreshSchedule,
} from "@/lib/device/defaults";
import type { RequestHeaders } from "@/lib/device/request-headers";
import { logError, logInfo } from "@/lib/logger";
import { DeviceDisplayMode } from "@/lib/mixup/constants";
import {
	isTimeInRange,
	localScheduleTime,
	selectPlaylistItem,
} from "@/lib/playlists/schedule";
import type { Device, PlaylistItem, RefreshSchedule } from "@/lib/types";

/** Bounds for the refresh interval sent to a device (seconds). */
export const MIN_REFRESH_SECONDS = 1;
export const MAX_REFRESH_SECONDS = 86_400;

export function clampRefreshSeconds(seconds: number): number {
	if (!Number.isFinite(seconds)) return DISPLAY_FALLBACK_REFRESH_SECONDS;
	return Math.min(
		MAX_REFRESH_SECONDS,
		Math.max(MIN_REFRESH_SECONDS, Math.round(seconds)),
	);
}

/** Refresh interval from the device's schedule at `at` in its timezone. */
export function calculateRefreshRate(
	refreshSchedule: RefreshSchedule | null,
	defaultRefreshRate: number,
	timezone = "UTC",
	at = new Date(),
): number {
	if (!refreshSchedule) {
		return defaultRefreshRate;
	}

	const { time } = localScheduleTime(at, timezone);
	for (const range of refreshSchedule.time_ranges) {
		if (isTimeInRange(time, range.start_time, range.end_time)) {
			return range.refresh_rate;
		}
	}
	return refreshSchedule.default_refresh_rate;
}

export type DisplayVisit = {
	/** Playlist mode only: the item to show, or null when none is eligible. */
	playlistItem: PlaylistItem | null;
	refreshRate: number;
};

type Conn = typeof db;

async function activePlaylistItem(
	conn: Conn,
	device: Device,
	at: Date,
): Promise<PlaylistItem | null> {
	if (!device.playlist_id) return null;
	const rows = await conn
		.selectFrom("playlist_items")
		.selectAll()
		.where("playlist_id", "=", device.playlist_id)
		.orderBy("order_index", "asc")
		.execute();
	if (rows.length === 0) {
		logError("No items in playlist", {
			source: "api/display",
			metadata: { playlistId: device.playlist_id },
		});
		return null;
	}
	const item = selectPlaylistItem(
		rows.map(mapPlaylistItemRow),
		device.current_playlist_index ?? -1,
		at,
		device.timezone || "UTC",
	);
	if (!item) {
		logInfo("No active playlist item found", {
			source: "api/display",
			metadata: { deviceId: device.friendly_id },
		});
	}
	return item;
}

async function writeDeviceStatus(
	conn: Conn,
	device: Device,
	headers: RequestHeaders,
	refreshSeconds: number,
	nextPlaylistIndex: number | undefined,
	at: Date,
): Promise<void> {
	const update: Record<string, unknown> = {
		last_update_time: at.toISOString(),
		next_expected_update: new Date(
			at.getTime() + refreshSeconds * 1000,
		).toISOString(),
		last_refresh_duration: Math.round(refreshSeconds),
		updated_at: at.toISOString(),
		supports_temperature_profile: headers.supportsTemperatureProfile,
	};
	if (nextPlaylistIndex !== undefined) {
		update.current_playlist_index = nextPlaylistIndex;
	}
	const battery = headers.batteryVoltage
		? Number.parseFloat(headers.batteryVoltage)
		: Number.NaN;
	if (Number.isFinite(battery)) update.battery_voltage = battery;
	const rssi = headers.rssi ? Number.parseInt(headers.rssi, 10) : Number.NaN;
	if (Number.isFinite(rssi)) update.rssi = rssi;
	if (headers.fwVersion) update.firmware_version = headers.fwVersion;

	try {
		await conn
			.updateTable("devices")
			.set(update)
			.where("id", "=", String(device.id))
			.execute();
	} catch (error) {
		logError("Error updating device status", {
			source: "api/display",
			metadata: { deviceId: device.id, error },
		});
		// A playlist must not advance without persisting its position. Status-only
		// telemetry is best effort.
		if (nextPlaylistIndex !== undefined) throw error;
	}
}

/**
 * Decide what a device shows next and record the visit — playlist read and
 * status/position write share ONE scoped session.
 */
export async function recordDisplayVisit(
	device: Device,
	headers: RequestHeaders,
	at = new Date(),
	options: { restartPlaylist?: boolean } = {},
): Promise<DisplayVisit> {
	const run = async (conn: Conn): Promise<DisplayVisit> => {
		const playlistMode = device.display_mode === DeviceDisplayMode.PLAYLIST;
		const playlistItem = playlistMode
			? await activePlaylistItem(
					conn,
					options.restartPlaylist
						? { ...device, current_playlist_index: -1 }
						: device,
					at,
				)
			: null;
		const refreshRate = clampRefreshSeconds(
			playlistMode
				? (playlistItem?.duration ?? DISPLAY_FALLBACK_REFRESH_SECONDS)
				: calculateRefreshRate(
						normalizeRefreshSchedule(device.refresh_schedule),
						DISPLAY_FALLBACK_REFRESH_SECONDS,
						device.timezone || "UTC",
						at,
					),
		);
		await writeDeviceStatus(
			conn,
			device,
			headers,
			refreshRate,
			playlistItem?.order_index,
			at,
		);
		return { playlistItem, refreshRate };
	};
	return device.user_id ? withExplicitUserScope(device.user_id, run) : run(db);
}
