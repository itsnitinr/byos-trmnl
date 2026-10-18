import { resolveModelForStorage } from "./model-storage";

jest.mock("@/lib/cache/after-response", () => ({ afterResponse: jest.fn() }));
beforeAll(() => {
	process.env.TRMNL_REGISTRY_OFFLINE = "true";
});

test("registry model names are taken as reported", async () => {
	expect(await resolveModelForStorage("v2", "og_plus")).toMatchObject({
		modelName: "v2",
	});
});

test("firmware board names map to their registry model", async () => {
	// A TRMNL X stored as the default OG model is corrected automatically.
	expect(await resolveModelForStorage("x", "og_plus")).toMatchObject({
		modelName: "v2",
		preservedExisting: false,
	});
	expect(await resolveModelForStorage("og_4clr", null)).toMatchObject({
		modelName: "og_bwry",
	});
});

test("an owner's choice within the board's family is kept", async () => {
	const result = await resolveModelForStorage("og", "og_png");
	expect(result.modelName).toBeUndefined();
	expect(result).toMatchObject({
		resolvedModelName: "og_png",
		preservedExisting: true,
	});
	expect(result.reportedUnknown).toBeUndefined();
});

test("boards with varying panels keep the configured model", async () => {
	const result = await resolveModelForStorage(
		"seeed_esp32s3",
		"waveshare_7_5_bw",
	);
	expect(result).toMatchObject({
		reportedUnknown: "seeed_esp32s3",
		resolvedModelName: "waveshare_7_5_bw",
		preservedExisting: true,
	});
	expect(result.modelName).toBeUndefined();
});
