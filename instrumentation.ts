/**
 * Next.js boot hook. Runs ONCE per server process — not per request.
 *
 * - Reports configuration problems (missing secrets, unknown option values).
 * - Optionally applies pending migrations (`AUTO_MIGRATE=true`), so container
 *   deployments come up ready without visiting the setup screen.
 * - Starts hourly maintenance (log retention, stale device claims).
 * - Seeds the in-DB recipe catalog from the in-process React recipe registry.
 *   Built-in recipes are defined in code, but the DB still needs rows for
 *   foreign keys (mixup_slots, etc.) and for the mixup picker UI. The runtime
 *   resolves React recipes from the registry directly, so this sync is a
 *   one-shot bootstrap, never a request-time mirror.
 */
export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	if (process.env.NEXT_PHASE === "phase-production-build") return;

	const { reportRuntimeConfig } = await import("./lib/config");
	reportRuntimeConfig();

	if (process.env.AUTO_MIGRATE === "true" && process.env.DATABASE_URL) {
		try {
			const { runMigrations } = await import("./lib/database/migrate");
			const run = await runMigrations(process.env.DATABASE_URL, {
				log: (message) => console.log(message),
			});
			if (!run.ok) {
				const failure = run.failed ? run.results[run.failed]?.error : null;
				console.error(
					`[instrumentation] Migrations failed${run.failed ? ` at ${run.failed}` : ""}: ${failure ?? "schema validation failed"}`,
				);
			}
		} catch (error) {
			console.error("[instrumentation] Migrations could not run:", error);
		}
	}

	const { checkDbConnection } = await import("./lib/database/utils");
	await checkDbConnection();
	const { startMaintenance } = await import("./lib/database/maintenance");
	startMaintenance();
	if (process.env.SKIP_RECIPE_SYNC === "true") return;

	try {
		const { syncReactRecipes } = await import(
			"./lib/recipes/sync-react-recipes"
		);
		await syncReactRecipes();
	} catch (error) {
		console.warn("[instrumentation] Recipe sync failed at boot:", error);
	}
}
