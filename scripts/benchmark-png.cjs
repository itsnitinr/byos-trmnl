/** Compare the previous dual-encoding path with exact indexed PNGs. Run: pnpm benchmark:png */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const sharp = require("sharp");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
Module._extensions[".ts"] = (mod, file) => {
	mod._compile(
		ts.transpileModule(fs.readFileSync(file, "utf8"), {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ES2022,
				esModuleInterop: true,
			},
		}).outputText,
		file,
	);
};
const { encodeIndexedPng } = require("../lib/render/indexed-png.ts");
const median = (values) =>
	values.sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function main() {
	for (const file of [
		"800x480-bw.png",
		"480x800-gray-4.png",
		"1872x1404-gray-16.png",
	]) {
		const { data, info } = await sharp(path.join(root, "tests/rendering", file))
			.removeAlpha()
			.toColourspace("srgb")
			.raw()
			.toBuffer({ resolveWithObject: true });
		const colors = new Map();
		for (let i = 0; i < data.length; i += 3)
			colors.set((data[i] << 16) | (data[i + 1] << 8) | data[i + 2], [
				data[i],
				data[i + 1],
				data[i + 2],
			]);
		const palette = [...colors.values()];
		const previousTimes = [],
			indexedTimes = [];
		let previous, indexed;
		// One warm-up and five measured samples; this measures encoding only.
		for (let sample = 0; sample < 6; sample++) {
			let start = performance.now();
			const rgb = await sharp(data, { raw: info })
				.png({ compressionLevel: 9, effort: 10 })
				.toBuffer();
			const quantized = await sharp(data, { raw: info })
				.png({
					palette: true,
					colours: palette.length,
					compressionLevel: 9,
					effort: 10,
					dither: 0,
				})
				.toBuffer();
			previous = rgb.length < quantized.length ? rgb : quantized;
			if (sample) previousTimes.push(performance.now() - start);
			start = performance.now();
			indexed = await encodeIndexedPng(data, info.width, info.height, palette);
			if (sample) indexedTimes.push(performance.now() - start);
		}
		assert(indexed, "Palette encoding must succeed");
		const pixels = await sharp(indexed)
			.removeAlpha()
			.toColourspace("srgb")
			.raw()
			.toBuffer();
		assert(pixels.equals(data), "Decoded pixels must match exactly");
		const previousMs = median(previousTimes),
			indexedMs = median(indexedTimes);
		console.log(
			JSON.stringify({
				file,
				previousMs: +previousMs.toFixed(2),
				indexedMs: +indexedMs.toFixed(2),
				speedup: +(previousMs / indexedMs).toFixed(1),
				previousBytes: previous.length,
				indexedBytes: indexed.length,
				pixels: "identical",
			}),
		);
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
