import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

jest.mock("@/lib/cache/after-response", () => ({ afterResponse: jest.fn() }));

const bundled = JSON.parse(
	readFileSync(path.join(process.cwd(), "data/trmnl/models.json"), "utf8"),
) as { data: { name: string }[] };

beforeEach(() => {
	jest.resetModules();
	process.env.TRMNL_REGISTRY_OFFLINE = "true";
	process.env.TRMNL_REGISTRY_CACHE_DIR = mkdtempSync(
		path.join(tmpdir(), "byos-registry-"),
	);
});

afterAll(() => {
	delete process.env.TRMNL_REGISTRY_OFFLINE;
	delete process.env.TRMNL_REGISTRY_CACHE_DIR;
});

test("falls back to the bundled snapshot", async () => {
	const { listModels } = require("./registry") as typeof import("./registry");
	const models = await listModels();
	expect(models.map((m) => m.name)).toEqual(bundled.data.map((m) => m.name));
});

test("prefers a refreshed snapshot from the cache directory", async () => {
	const refreshed = {
		data: [{ ...bundled.data[0], name: "refreshed_model" }],
	};
	writeFileSync(
		path.join(process.env.TRMNL_REGISTRY_CACHE_DIR as string, "models.json"),
		JSON.stringify(refreshed),
	);
	const { listModels } = require("./registry") as typeof import("./registry");
	expect((await listModels()).map((m) => m.name)).toEqual(["refreshed_model"]);
});
