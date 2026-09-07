import {
	diagnoseRender,
	getRenderDiagnostics,
	measureRenderStage,
	recordCacheStatus,
	renderTimingHeader,
} from "./diagnostics";

test("records stage timings, failures, and cache status without crossing users", async () => {
	const { trace } = await diagnoseRender(
		"alice-test",
		"weather",
		800,
		480,
		async () => {
			await measureRenderStage("fetch", async () => 42);
			recordCacheStatus("raster", "hit");
			return { buffer: Buffer.from("pixels") };
		},
	);
	expect(trace.bytes).toBe(6);
	expect(trace.cache.raster).toBe("hit");
	expect(renderTimingHeader(trace)).toMatch(/fetch;dur=/);
	expect(getRenderDiagnostics("alice-test")).toHaveLength(1);
	expect(getRenderDiagnostics("bob-test")).toHaveLength(0);
	await expect(
		diagnoseRender("bob-test", "weather", 800, 480, async () => {
			throw Error("secret URL");
		}),
	).rejects.toThrow();
	expect(getRenderDiagnostics("bob-test")[0].status).toBe("error");
	expect(JSON.stringify(getRenderDiagnostics("bob-test"))).not.toContain(
		"secret URL",
	);
});
