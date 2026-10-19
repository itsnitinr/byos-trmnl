import { recipeFetch, withRecipeDeadline } from "./fetch-context";

afterEach(() => jest.restoreAllMocks());

test("a failed required fetch marks the recipe source unavailable", async () => {
	jest
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(new Response("missing", { status: 404 }));
	await expect(
		withRecipeDeadline(
			async () => (await recipeFetch("https://a.test")).status,
		),
	).rejects.toThrow("Recipe source unavailable");
});

test("optional fetch misses are left to the recipe", async () => {
	const mock = jest
		.spyOn(globalThis, "fetch")
		.mockResolvedValueOnce(new Response("missing", { status: 404 }))
		.mockRejectedValueOnce(new Error("offline"));
	const result = await withRecipeDeadline(async () => {
		const miss = await recipeFetch("https://a.test", { optional: true });
		const error = await recipeFetch("https://b.test", {
			optional: true,
		}).catch(() => "caught");
		return [miss.status, error];
	});
	expect(result).toEqual([404, "caught"]);
	// The option is ours; it must not reach the platform fetch.
	expect(mock.mock.calls[0][1]).not.toHaveProperty("optional");
	expect(mock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
});
