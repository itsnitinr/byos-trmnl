import { generatePrint, printStyles, resolvePrintStyle } from "./artwork";

const edition = { date: "2026-10-15", seed: "", width: 748, height: 310 };

test.each(
	printStyles,
)("%s editions are reproducible and vary with date and personal seed", (style) => {
	const print = generatePrint({ ...edition, style });
	expect(generatePrint({ ...edition, style })).toEqual(print);
	expect(generatePrint({ ...edition, style, date: "2026-10-16" }).svg).not.toBe(
		print.svg,
	);
	expect(generatePrint({ ...edition, style, seed: "studio" }).svg).not.toBe(
		print.svg,
	);
});

test("daily rotation visits every style and repeats after three days", () => {
	const styles = ["2026-10-15", "2026-10-16", "2026-10-17"].map((date) =>
		resolvePrintStyle("daily", date),
	);
	expect(new Set(styles)).toEqual(new Set(printStyles));
	expect(resolvePrintStyle("daily", "2026-10-18")).toBe(styles[0]);
	for (const style of printStyles) {
		expect(resolvePrintStyle(style, "2026-10-16")).toBe(style);
	}
	expect(generatePrint({ ...edition, style: "daily" }).svg).toBe(
		generatePrint({ ...edition, style: styles[0] }).svg,
	);
});

test("personal seed is hashed, never interpolated into SVG markup", () => {
	const print = generatePrint({
		...edition,
		style: "tiles",
		seed: '<script>alert("seed")</script>',
	});
	expect(print.svg).not.toContain("script");
	expect(print.svg).not.toMatch(/NaN|Infinity/);
});
