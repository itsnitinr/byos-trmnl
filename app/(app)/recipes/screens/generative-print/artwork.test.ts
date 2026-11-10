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

test("daily rotation visits every style before repeating", () => {
	const start = Date.parse("2026-10-15T12:00:00Z");
	const dateAt = (day: number) =>
		new Date(start + day * 86_400_000).toISOString().slice(0, 10);
	const styles = printStyles.map((_, day) =>
		resolvePrintStyle("daily", dateAt(day)),
	);
	expect(new Set(styles)).toEqual(new Set(printStyles));
	expect(resolvePrintStyle("daily", dateAt(printStyles.length))).toBe(
		styles[0],
	);
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

test.each(printStyles)("%s scales its geometry with the canvas", (style) => {
	const small = generatePrint({ ...edition, style, width: 640, height: 320 });
	const large = generatePrint({ ...edition, style, width: 1280, height: 640 });
	expect(small.svg.slice(small.svg.indexOf("viewBox"))).toBe(
		large.svg.slice(large.svg.indexOf("viewBox")),
	);
});

test.each(
	printStyles,
)("%s produces bounded, finite geometry across layouts", (style) => {
	for (const [width, height] of [
		[748, 310],
		[364, 160],
		[164, 280],
		[444, 620],
		[988, 574],
	]) {
		const { svg } = generatePrint({ ...edition, style, width, height });
		expect(svg).not.toMatch(/NaN|Infinity|undefined/);
		expect(svg.length).toBeLessThan(1_000_000);
		expect(svg).not.toMatch(/<image|<script|<filter|opacity=/);
	}
});
