import { connection } from "next/server";
import { checkDbConnection } from "@/lib/database/utils";

/**
 * GET /api/health — liveness for container healthchecks and uptime monitors.
 *
 * Answers 200 whenever the server can serve requests; the database state is
 * reported but does not fail the check (restarting the app cannot fix the
 * database). Use `?require=database` for a readiness probe that does.
 * Deliberately free of error details: this endpoint is public.
 */
export async function GET(request: Request) {
	await connection();
	const requireDatabase =
		new URL(request.url).searchParams.get("require") === "database";
	let database: "ready" | "unavailable" | "not_configured" = "not_configured";
	if (process.env.DATABASE_URL) {
		const status = await checkDbConnection().catch(() => null);
		database = status?.ready ? "ready" : "unavailable";
	}
	const healthy = !requireDatabase || database === "ready";
	return Response.json(
		{
			status: healthy ? "ok" : "degraded",
			database,
			uptime: Math.round(process.uptime()),
		},
		{
			status: healthy ? 200 : 503,
			headers: { "Cache-Control": "no-store" },
		},
	);
}
