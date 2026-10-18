import { cache } from "react";
import { canReadSystemLogs } from "@/app/actions/system";
import {
	mapDeviceRows,
	mapMixupRow,
	mapPlaylistItemRow,
	mapPlaylistRow,
	mapSystemLogRow,
} from "@/lib/database/mappers";
import { withUserScope } from "@/lib/database/scoped-db";
import { getDbStatus } from "@/lib/database/utils";
import type {
	Device,
	Mixup,
	Playlist,
	PlaylistItem,
	SystemLog,
} from "@/lib/types";
import "server-only";

export type InitialData = {
	devices: Device[];
	playlists: Playlist[];
	playlistItems: PlaylistItem[];
	mixups: Mixup[];
	systemLogs: SystemLog[];
	dbStatus: {
		ready: boolean;
		error?: string;
		databaseConfigured: boolean;
	};
};

/**
 * Centralized cached function to get all initial application data.
 *
 * This function fetches and returns all necessary data for the application:
 * - Devices, logs, and other data from the database
 * - Status of the database connection
 * - Host URL and other environmental data
 *
 * The data is cached using React's cache() function, which means:
 * - Multiple calls to this function during the same request will be deduplicated
 * - The data can be shared across different components and pages
 * - Navigation between pages will not cause duplicate data fetching
 *
 * @returns Promise<InitialData> All the application's data
 */
export const getInitData = cache(async (): Promise<InitialData> => {
	const dbStatus = await getDbStatus();

	// Default empty values if DB is not ready
	let devices: Device[] = [];
	let systemLogs: SystemLog[] = [];
	let playlists: Playlist[] = [];
	let playlistItems: PlaylistItem[] = [];
	let mixups: Mixup[] = [];

	// Fetch data only if DB is ready
	if (dbStatus.ready) {
		try {
			const includeSystemLogs = await canReadSystemLogs();
			// Use withUserScope to set RLS context - database handles user filtering
			const [
				devicesResult,
				playlistsResult,
				playlistItemsResult,
				mixupsResult,
				logsResult,
			] = await withUserScope((scopedDb) =>
				Promise.all([
					// Fetch devices (RLS filters by user)
					scopedDb.selectFrom("devices").selectAll().execute(),
					// Fetch playlists (RLS filters by user)
					scopedDb.selectFrom("playlists").selectAll().execute(),
					// Fetch playlist items
					scopedDb
						.selectFrom("playlist_items")
						.selectAll()
						.orderBy("playlist_id", "asc")
						.orderBy("order_index", "asc")
						.execute(),
					// Fetch mixups (RLS filters by user)
					scopedDb
						.selectFrom("mixups")
						.selectAll()
						.orderBy("created_at", "desc")
						.execute(),
					// Recent system logs for the dashboard (admin only; not tenant data)
					includeSystemLogs
						? scopedDb
								.selectFrom("system_logs")
								.selectAll()
								.orderBy("created_at", "desc")
								.limit(5)
								.execute()
						: Promise.resolve([]),
				]),
			);

			devices = mapDeviceRows(devicesResult);
			playlists = playlistsResult.map(mapPlaylistRow);
			playlistItems = playlistItemsResult.map(mapPlaylistItemRow);
			mixups = mixupsResult.map(mapMixupRow);
			systemLogs = logsResult.map(mapSystemLogRow);
		} catch (error) {
			console.error("Error fetching initial data:", error);
		}
	}

	return {
		devices,
		playlists,
		playlistItems,
		mixups,
		systemLogs,
		dbStatus,
	};
});
