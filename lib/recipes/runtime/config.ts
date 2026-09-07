import { sql } from "kysely";
import { getCurrentUserId } from "@/lib/auth/get-user";
import { withExplicitUserScope } from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";

/** One owner-scoped read for both render params and their refresh interval. No cross-request caching. */
export async function loadRecipeConfig(slug: string, userId?: string | null) {
	const owner = userId ?? (await getCurrentUserId());
	if (!owner || !(await checkDbConnection()).ready)
		return { params: {}, dataRefreshSeconds: null, editable: false };
	const row = await withExplicitUserScope(owner, (db) =>
		db
			.selectFrom("screen_configs")
			.select(["params", "data_refresh_seconds", "user_id"])
			.where("screen_id", "=", slug)
			.orderBy(
				sql`CASE WHEN user_id = current_setting('app.current_user_id', true) THEN 0 ELSE 1 END`,
			)
			.executeTakeFirst(),
	);
	let parsed: unknown = row?.params ?? {};
	if (typeof parsed === "string") parsed = JSON.parse(parsed);
	return {
		params:
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {},
		dataRefreshSeconds:
			row?.user_id === owner ? row.data_refresh_seconds : null,
		editable: true,
	};
}
