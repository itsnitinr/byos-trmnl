import { canOfferGenericFirmware, isUpdateAvailable } from "./firmware";

test("only boards running the generic OG build are offered it", () => {
	expect(canOfferGenericFirmware("og")).toBe(true);
	expect(canOfferGenericFirmware(null)).toBe(true); // pre-Model-header OG firmware
	for (const model of [
		"x",
		"seeed_esp32s3",
		"seeed_esp32c3",
		"xiao_epaper_mini",
		"og_4clr",
		"waveshare",
		"m5_papers3",
	]) {
		expect(canOfferGenericFirmware(model)).toBe(false);
	}
});

test("compares versions numerically", () => {
	expect(isUpdateAvailable("1.6.9", "1.6.10")).toBe(true);
	expect(isUpdateAvailable("1.7.0", "1.6.10")).toBe(false);
	expect(isUpdateAvailable(null, "1.6.10")).toBe(false);
});
