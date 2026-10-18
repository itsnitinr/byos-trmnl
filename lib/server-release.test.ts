import {
	clearServerReleaseCache,
	getLatestServerRelease,
} from "./server-release";

const fetchMock = jest.fn();

beforeEach(() => {
	clearServerReleaseCache();
	fetchMock.mockReset();
	global.fetch = fetchMock as unknown as typeof fetch;
	jest.spyOn(console, "warn").mockImplementation(() => {});
});

test("shares one lookup between concurrent callers and caches it", async () => {
	fetchMock.mockResolvedValue(
		new Response(JSON.stringify({ tag_name: "v1.2.3", name: "v1.2.3" })),
	);
	const [a, b] = await Promise.all([
		getLatestServerRelease(),
		getLatestServerRelease(),
	]);
	expect(a?.version).toBe("1.2.3");
	expect(b).toBe(a);
	await getLatestServerRelease();
	expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("backs off after a failure instead of retrying on every call", async () => {
	fetchMock.mockRejectedValue(new Error("offline"));
	expect(await getLatestServerRelease()).toBeNull();
	expect(await getLatestServerRelease()).toBeNull();
	expect(fetchMock).toHaveBeenCalledTimes(1);
});
