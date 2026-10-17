import { type RawBuilder, sql } from "kysely";
import { getCurrentUserId } from "@/lib/auth/get-user";
import { db } from "./db";

/**
 * The role used for application queries. This role must:
 * - Exist in the database (created by migration 0009)
 * - NOT have BYPASSRLS attribute
 * - Have SELECT, INSERT, UPDATE, DELETE on all tenant tables
 */
const APP_ROLE = "byos_app";

/** Session variables read by the RLS policies. */
type ScopeSettings = {
	/** `app.current_user_id`: the tenant whose rows are visible. */
	userId?: string;
	/** `app.device_api_key`: exposes the single device row with this key. */
	deviceApiKey?: string;
	/** `app.capability_lookup_uuid`: exposes one plugin_settings row by UUID. */
	capabilityUuid?: string;
	/** `app.shared_recipe_seed`: allows writing shared (user_id IS NULL) recipes. */
	sharedRecipeSeed?: boolean;
};

/**
 * Switch to the app role and set every RLS variable in ONE round trip.
 *
 * All variables are always written, so a scope never inherits a value left on
 * a pooled connection by an earlier scope whose cleanup failed.
 * `local` scopes the settings to the current transaction.
 */
function enterScope(
	settings: ScopeSettings,
	local: boolean,
): RawBuilder<unknown> {
	const isLocal = sql.raw(local ? "true" : "false");
	return sql`SELECT
		set_config('role', ${APP_ROLE}, ${isLocal}),
		set_config('app.current_user_id', ${settings.userId ?? ""}, ${isLocal}),
		set_config('app.device_api_key', ${settings.deviceApiKey ?? ""}, ${isLocal}),
		set_config('app.capability_lookup_uuid', ${settings.capabilityUuid ?? ""}, ${isLocal}),
		set_config('app.shared_recipe_seed', ${settings.sharedRecipeSeed ? "on" : ""}, ${isLocal})`;
}

/** Clear the variables and restore the login role, also in one round trip. */
const leaveScope = sql`SELECT
	set_config('app.current_user_id', '', false),
	set_config('app.device_api_key', '', false),
	set_config('app.capability_lookup_uuid', '', false),
	set_config('app.shared_recipe_seed', '', false),
	set_config('role', 'none', false)`;

/**
 * Acquire a pooled connection, enter the scope, run the callback, then reset
 * before releasing the connection. Without the reset, the variables would
 * persist on the connection and a later unscoped query on that same pooled
 * connection would inherit them.
 */
async function runScoped<T>(
	settings: ScopeSettings,
	callback: (scopedDb: typeof db) => Promise<T>,
): Promise<T> {
	return db.connection().execute(async (conn) => {
		await enterScope(settings, false).execute(conn);
		try {
			return await callback(conn);
		} finally {
			try {
				await leaveScope.execute(conn);
			} catch {
				// Connection already broken. Every scope re-sets all variables on
				// entry, and the owner role is unaffected by them.
			}
		}
	});
}

/**
 * Execute a database operation with user context for Row Level Security.
 *
 * Gets the current user ID from the session, switches to the non-superuser
 * role so RLS is enforced, and sets `app.current_user_id` for the policies.
 *
 * @example
 * ```ts
 * const devices = await withUserScope(async (db) => {
 *   return db.selectFrom("devices").selectAll().execute();
 * });
 * ```
 */
export async function withUserScope<T>(
	callback: (scopedDb: typeof db) => Promise<T>,
): Promise<T> {
	const userId = await getCurrentUserId();
	return runScoped({ userId: userId ?? "" }, callback);
}

/**
 * Execute a database operation scoped to a specific user ID for RLS.
 *
 * Use this when the user ID is known from context other than the HTTP session
 * (e.g. resolved from a device access token).
 */
export async function withExplicitUserScope<T>(
	userId: string,
	callback: (scopedDb: typeof db) => Promise<T>,
): Promise<T> {
	return runScoped({ userId }, callback);
}

/**
 * Execute a database operation as `byos_app` with the plugin-settings
 * capability UUID set, so the matching `plugin_settings` row is selectable
 * even without a session user. The lookup is intentionally one-row,
 * uuid-equality only — the policy in 0016 is `uuid = current_setting(...)`.
 *
 * The TRMNL contract treats plugin-setting UUIDs as capability URLs; this
 * helper is the single privileged path that turns one into the row's owner
 * before we re-scope to that owner for any actual mutation.
 */
export async function withCapabilityUuid<T>(
	uuid: string,
	callback: (scopedDb: typeof db) => Promise<T>,
): Promise<T> {
	return runScoped({ capabilityUuid: uuid }, callback);
}

/**
 * Execute a database operation with only a device access token available.
 *
 * This is intentionally limited to the RLS policy keyed by
 * `app.device_api_key`; callers should use it to resolve the owning user, then
 * switch to `withExplicitUserScope` for normal tenant-scoped work.
 */
export async function withDeviceApiKey<T>(
	apiKey: string,
	callback: (scopedDb: typeof db) => Promise<T>,
): Promise<T> {
	return runScoped({ deviceApiKey: apiKey }, callback);
}

/**
 * Execute the boot-time shared-recipe seed under RLS. Migration 0016 adds an
 * INSERT/UPDATE policy for rows with `user_id IS NULL` that only fires when
 * `app.shared_recipe_seed = 'on'`. The flag is intentionally scoped to this
 * helper so request-time code paths can never trip it.
 */
export async function withSharedRecipeSeed<T>(
	callback: (scopedDb: typeof db) => Promise<T>,
): Promise<T> {
	return runScoped({ sharedRecipeSeed: true }, callback);
}

/**
 * Execute a database transaction with user context for Row Level Security.
 *
 * Same as withUserScope but wraps everything in a transaction. The role and
 * variables are transaction-local, so COMMIT/ROLLBACK resets them.
 *
 * @example
 * ```ts
 * const result = await withUserScopeTransaction(async (trx) => {
 *   await trx.insertInto("playlists").values({ name: "My Playlist", user_id: userId }).execute();
 *   return trx.selectFrom("playlists").selectAll().execute();
 * });
 * ```
 */
export async function withUserScopeTransaction<T>(
	callback: (trx: typeof db) => Promise<T>,
): Promise<T> {
	const userId = await getCurrentUserId();
	return db.transaction().execute(async (trx) => {
		await enterScope({ userId: userId ?? "" }, true).execute(trx);
		return callback(trx);
	});
}
