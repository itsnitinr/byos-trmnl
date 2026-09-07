import { fetchPublicResource } from "./public-fetch";
import { cachedPublicResource } from "./resource-cache";

jest.mock("./public-fetch", () => ({ fetchPublicResource: jest.fn() }));
const fetchResource = jest.mocked(fetchPublicResource);
const resource = (control: string) => ({
	body: Buffer.from("image"),
	status: 200,
	url: "https://example.com/image",
	headers: { "cache-control": control },
});
afterEach(() => {
	jest.restoreAllMocks();
	fetchResource.mockReset();
});

test("shares in-flight public downloads and expires at the upstream max-age", async () => {
	let now = 1000;
	jest.spyOn(Date, "now").mockImplementation(() => now);
	fetchResource.mockResolvedValue(resource("public, max-age=2"));
	const url = "https://example.com/coalesced";
	await Promise.all([cachedPublicResource(url), cachedPublicResource(url)]);
	await cachedPublicResource(url);
	expect(fetchResource).toHaveBeenCalledTimes(1);
	now += 2001;
	await cachedPublicResource(url);
	expect(fetchResource).toHaveBeenCalledTimes(2);
});

test.each([
	"no-store",
	"private",
	"no-cache",
	"max-age=0",
])("does not retain %s responses", async (control) => {
	fetchResource.mockResolvedValue(resource(control));
	const url = `https://example.com/${control}`;
	await cachedPublicResource(url);
	await cachedPublicResource(url);
	expect(fetchResource).toHaveBeenCalledTimes(2);
});

test("does not cache failures", async () => {
	fetchResource
		.mockRejectedValueOnce(new Error("unavailable"))
		.mockResolvedValue(resource("max-age=60"));
	const url = "https://example.com/retry";
	await expect(cachedPublicResource(url)).rejects.toThrow("unavailable");
	await cachedPublicResource(url);
	expect(fetchResource).toHaveBeenCalledTimes(2);
});
