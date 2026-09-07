import { after } from "next/server";

/** Keep optional refresh work alive on supported serverless hosts, too. */
export function afterResponse(work: () => Promise<void>): void {
	const guarded = async () => {
		try {
			await work();
		} catch (error) {
			console.warn(
				"Background metadata refresh failed",
				error instanceof Error ? error.message : "Unknown error",
			);
		}
	};
	try {
		after(guarded);
	} catch {
		void guarded();
	} // Startup/CLI code has no request lifetime; Node owns the work.
}
