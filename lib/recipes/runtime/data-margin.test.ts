import { resolveCachedData, withFreshnessMargin } from "./data-cache";

jest.mock("@/lib/render/diagnostics", () => ({
	measureRenderStage: (_stage: string, work: () => Promise<unknown>) => work(),
}));

test("a freshness margin refetches data that would expire before the wake", async () => {
	let calls = 0;
	const fetchData = async () => ({ version: ++calls });
	const key = `margin-${Math.random()}`;

	await resolveCachedData(key, fetchData, 60_000);
	expect((await resolveCachedData(key, fetchData, 60_000)).data).toEqual({
		version: 1,
	});

	// Still fresh for 60 s, but not for another 60 s + 1 min: refetch now.
	const warmed = await withFreshnessMargin(60_000, () =>
		resolveCachedData(key, fetchData, 60_000),
	);
	expect(warmed.data).toEqual({ version: 2 });
	// The device's own request then reuses the warmed entry.
	expect((await resolveCachedData(key, fetchData, 60_000)).data).toEqual({
		version: 2,
	});
});
