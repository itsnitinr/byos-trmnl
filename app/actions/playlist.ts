"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/auth/get-user";
import {
	withUserScope,
	withUserScopeTransaction,
} from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";
import type { Playlist, PlaylistItem } from "@/lib/types";

const WEEKDAYS = [
	"sunday",
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
] as const;

const playlistIdSchema = z.uuid();

const clockTime = z
	.string()
	.regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Use HH:MM (24-hour)");
const optionalClockTime = z.preprocess(
	(value) => (value === "" || value === null ? undefined : value),
	clockTime.optional(),
);

const playlistSchema = z.object({
	id: z.uuid().optional(),
	name: z.string().trim().min(1, "Name is required").max(100),
	items: z
		.array(
			z.object({
				screen_id: z.string().trim().min(1).max(200),
				duration: z.coerce.number().int().min(1).max(86_400),
				order_index: z.coerce.number().int().min(0),
				start_time: optionalClockTime,
				end_time: optionalClockTime,
				days_of_week: z.array(z.enum(WEEKDAYS)).max(7).optional(),
			}),
		)
		.max(200),
});

function validationMessage(error: z.ZodError): string {
	const issue = error.issues[0];
	const field = issue?.path.join(".");
	return issue
		? field
			? `${field}: ${issue.message}`
			: issue.message
		: "Invalid input";
}

/**
 * Fetch all playlists
 */
export async function fetchPlaylists(): Promise<Playlist[]> {
	const { ready } = await checkDbConnection();

	if (!ready) {
		console.warn("Database client not initialized");
		return [];
	}

	const playlists = await withUserScope((scopedDb) =>
		scopedDb
			.selectFrom("playlists")
			.selectAll()
			.orderBy("created_at", "desc")
			.execute(),
	);

	return playlists as unknown as Playlist[];
}

/**
 * Fetch a single playlist with its items
 */
export async function fetchPlaylistWithItems(playlistId: string): Promise<{
	playlist: Playlist | null;
	items: PlaylistItem[];
}> {
	const { ready } = await checkDbConnection();

	if (!ready) {
		console.warn("Database client not initialized");
		return { playlist: null, items: [] };
	}
	if (!playlistIdSchema.safeParse(playlistId).success) {
		return { playlist: null, items: [] };
	}

	const [playlist, items] = await withUserScope((scopedDb) =>
		Promise.all([
			scopedDb
				.selectFrom("playlists")
				.selectAll()
				.where("id", "=", playlistId)
				.executeTakeFirst(),
			scopedDb
				.selectFrom("playlist_items")
				.selectAll()
				.where("playlist_id", "=", playlistId)
				.orderBy("order_index", "asc")
				.execute(),
		]),
	);

	if (!playlist) {
		return { playlist: null, items: [] };
	}

	return {
		playlist: playlist as unknown as Playlist,
		items: items as unknown as PlaylistItem[],
	};
}

/**
 * Delete a playlist and all its items. Devices using it fall back to their
 * "Playlist mode needs a playlist" screen (migration 0023 clears the link).
 */
export async function deletePlaylist(playlistId: string): Promise<{
	success: boolean;
	error?: string;
}> {
	const { ready } = await checkDbConnection();

	if (!ready) {
		console.warn("Database client not initialized");
		return { success: false, error: "Database client not initialized" };
	}
	if (!playlistIdSchema.safeParse(playlistId).success) {
		return { success: false, error: "Invalid playlist id" };
	}

	try {
		const result = await withUserScope((scopedDb) =>
			scopedDb
				.deleteFrom("playlists")
				.where("id", "=", playlistId)
				.executeTakeFirst(),
		);
		if (Number(result.numDeletedRows) === 0) {
			return { success: false, error: "Playlist not found" };
		}

		revalidatePath("/playlists");
		return { success: true };
	} catch (error) {
		console.error("Error deleting playlist:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Save a complete playlist with all its items (create when `id` is absent).
 */
export async function savePlaylistWithItems(playlistData: {
	id?: string;
	name: string;
	items: Array<{
		id?: string;
		screen_id: string;
		duration: number;
		order_index: number;
		start_time?: string;
		end_time?: string;
		days_of_week?: string[];
	}>;
}): Promise<{ success: boolean; playlistId?: string; error?: string }> {
	const { ready } = await checkDbConnection();

	if (!ready) {
		console.warn("Database client not initialized");
		return { success: false, error: "Database client not initialized" };
	}

	const parsed = playlistSchema.safeParse(playlistData);
	if (!parsed.success) {
		return { success: false, error: validationMessage(parsed.error) };
	}
	const playlist = parsed.data;
	const userId = await getCurrentUserId();
	if (!userId) {
		return { success: false, error: "You must be signed in" };
	}

	try {
		const playlistId = await withUserScopeTransaction(async (trx) => {
			let id: string;

			if (playlist.id) {
				// RLS limits this to the caller's playlists.
				const updated = await trx
					.updateTable("playlists")
					.set({
						name: playlist.name,
						updated_at: new Date().toISOString(),
					})
					.where("id", "=", playlist.id)
					.executeTakeFirst();
				if (Number(updated.numUpdatedRows) === 0) return null;

				id = playlist.id;
				await trx
					.deleteFrom("playlist_items")
					.where("playlist_id", "=", id)
					.execute();
			} else {
				const created = await trx
					.insertInto("playlists")
					.values({ name: playlist.name, user_id: userId })
					.returning("id")
					.executeTakeFirstOrThrow();
				id = created.id;
			}

			if (playlist.items.length > 0) {
				await trx
					.insertInto("playlist_items")
					.values(
						playlist.items.map((item) => ({
							playlist_id: id,
							screen_id: item.screen_id,
							duration: item.duration,
							start_time: item.start_time ?? null,
							end_time: item.end_time ?? null,
							days_of_week: item.days_of_week?.length
								? JSON.stringify(item.days_of_week)
								: null,
							order_index: item.order_index,
						})),
					)
					.execute();
			}
			return id;
		});

		if (!playlistId) {
			return { success: false, error: "Playlist not found" };
		}
		revalidatePath("/playlists");
		return { success: true, playlistId };
	} catch (error) {
		console.error("Error saving playlist with items:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
