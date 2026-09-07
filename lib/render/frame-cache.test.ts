import {
	type RasterizeOptions,
	rasterize,
} from "@/lib/recipes/render/rasterize";
import { cachedRasterize } from "./frame-cache";
import { stampStaleImage } from "./stale-image";

jest.mock("@/lib/recipes/render/rasterize", () => ({
	rasterize: jest.fn(),
	getRendererType: () => "takumi",
}));
jest.mock("./stale-image", () => ({
	stampStaleImage: jest.fn(async () => Buffer.from("stale")),
}));
const render = jest.mocked(rasterize);
beforeEach(() => {
	render.mockReset().mockResolvedValue({ png: Buffer.from("image") });
	jest.mocked(stampStaleImage).mockClear();
});
afterEach(() => jest.restoreAllMocks());
const options = (slug: string): RasterizeOptions => ({
	slug,
	html: "<div>hello</div>",
	imageWidth: 800,
	imageHeight: 480,
	userId: "alice",
});

test("fresh data timestamps do not invalidate identical content; changed data and users do", async () => {
	const input = options("data-test");
	await cachedRasterize(
		{ ...input, freshness: { stale: false, updatedAt: 1 } },
		{ data: 1 },
	);
	await cachedRasterize(
		{ ...input, freshness: { stale: false, updatedAt: 2 } },
		{ data: 1 },
	);
	expect(render).toHaveBeenCalledTimes(1);
	await cachedRasterize(input, { data: 2 });
	await cachedRasterize({ ...input, userId: "bob" }, { data: 2 });
	expect(render).toHaveBeenCalledTimes(3);
});

test("explicit long-lived frames survive device refreshes and editions invalidate immediately", async () => {
	let now = 1000;
	jest.spyOn(Date, "now").mockImplementation(() => now);
	const input = {
		...options("edition-test"),
		renderSettings: { cacheSeconds: 86400 },
	};
	await cachedRasterize(input, { edition: "2026-09-07" });
	now += 900_000;
	expect(
		(await cachedRasterize(input, { edition: "2026-09-07" })).cacheStatus,
	).toBe("hit");
	await cachedRasterize(input, { edition: "2026-09-08" });
	expect(render).toHaveBeenCalledTimes(2);
});

test("default lifetime stays short for clocks and undeclared content", async () => {
	let now = 1000;
	jest.spyOn(Date, "now").mockImplementation(() => now);
	const input = options("clock-test");
	await cachedRasterize(input, {});
	now += 30_001;
	await cachedRasterize(input, {});
	expect(render).toHaveBeenCalledTimes(2);
});

test("stale markings are cached separately and fresh recovery restores a clean frame", async () => {
	const input = options("stale-test");
	await cachedRasterize(input, {});
	const stale = { ...input, freshness: { stale: true, updatedAt: 5 } };
	expect((await cachedRasterize(stale, {})).png?.toString()).toBe("stale");
	await cachedRasterize(stale, {});
	expect(stampStaleImage).toHaveBeenCalledTimes(1);
	expect((await cachedRasterize(input, {})).png?.toString()).toBe("image");
	expect(render).toHaveBeenCalledTimes(2);
});
