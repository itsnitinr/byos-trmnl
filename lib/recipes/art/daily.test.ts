import { botanicalStudy } from "@/app/(app)/recipes/screens/botanical-plate/botanical-plate";
import { dailyPrint } from "@/app/(app)/recipes/screens/daily-print/daily-print";
import { moonPhase } from "@/app/(app)/recipes/screens/moon-almanac/moon-almanac";
import { dailyArtParams, editionDate } from "./daily";

test("editions switch at local midnight and can be pinned to a date", () => {
	const params = dailyArtParams.parse({ timezone: "Asia/Kolkata" });
	expect(editionDate(params, new Date("2026-09-07T18:29:59Z"))).toBe(
		"2026-09-07",
	);
	expect(editionDate(params, new Date("2026-09-07T18:30:00Z"))).toBe(
		"2026-09-08",
	);
	expect(editionDate({ ...params, date: "2026-02-12" })).toBe("2026-02-12");
	expect(dailyArtParams.safeParse({ date: "2026-02-30" }).success).toBe(false);
	expect(dailyArtParams.safeParse({ timezone: "nowhere" }).success).toBe(false);
});
test("daily drawings are reproducible without global random state", () => {
	for (const draw of [dailyPrint, botanicalStudy]) {
		expect(draw("2026-09-08")).toEqual(draw("2026-09-08"));
		expect(draw("2026-09-08").svg).not.toBe(draw("2026-09-09").svg);
	}
});
test("mean lunar model has the expected illumination at reference phases", () => {
	const epoch = Date.parse("2000-01-06T18:14:00Z"),
		month = 29.530588 * 86_400_000;
	expect(moonPhase(new Date(epoch)).illumination).toBeCloseTo(0, 5);
	expect(moonPhase(new Date(epoch + month / 4)).illumination).toBeCloseTo(
		0.5,
		5,
	);
	expect(moonPhase(new Date(epoch + month / 2)).illumination).toBeCloseTo(1, 5);
	expect(moonPhase(new Date(epoch - month / 4)).label).toBe("Last quarter");
});
