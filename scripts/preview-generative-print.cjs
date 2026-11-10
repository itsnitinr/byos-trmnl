/** Render reproducible recipe previews without a server, database, or external services.
 * Run: node scripts/preview-generative-print.cjs [individual-image-directory]
 * Uses the real recipe, bundled fonts, Takumi, and device encoder. Only Next's
 * compile-time font declarations use the existing standalone font shim.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const sharp = require("sharp");
const root = path.resolve(__dirname, "..");
process.chdir(root);
process.env.REACT_RENDERER = "takumi";

const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...args) {
	const source = /^next\/font\/(google|local)$/.test(name)
		? path.join(root, "tests/mocks/next-font.ts")
		: name.startsWith("@/")
			? path.join(root, name.slice(2))
			: name;
	return resolve.call(this, source, parent, ...args);
};
for (const ext of [".ts", ".tsx"]) {
	Module._extensions[ext] = (mod, file) => {
		const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
			compilerOptions: {
				target: ts.ScriptTarget.ES2022,
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
				esModuleInterop: true,
			},
		}).outputText;
		mod._compile(output, file);
	};
}

async function main() {
	const React = require("react");
	const {
		definition,
		paramsSchema,
	} = require("../app/(app)/recipes/screens/generative-print/generative-print.tsx");
	const {
		printStyles,
	} = require("../app/(app)/recipes/screens/generative-print/artwork.ts");
	const { createScreenProfile } = require("../lib/trmnl/screen-profile.ts");
	const { rasterize } = require("../lib/recipes/render/rasterize.ts");
	const { renderDeviceImage } = require("../lib/render/device-image.ts");
	const models = JSON.parse(
		fs.readFileSync(path.join(root, "data/trmnl/models.json")),
	).data;
	const palettes = JSON.parse(
		fs.readFileSync(path.join(root, "data/trmnl/palettes.json")),
	).data;
	const palette = palettes.find((item) => item.id === "bw");
	const output = path.resolve(process.argv[2] || "/tmp/byos-generative-print");
	const screenshots = path.join(root, "docs/screenshots");
	fs.mkdirSync(output, { recursive: true });
	fs.mkdirSync(screenshots, { recursive: true });
	const samples = new Map();
	const layouts = [
		{ name: "landscape", width: 800, height: 480, model: "og_plus" },
		{ name: "portrait", width: 480, height: 800, model: "og_plus" },
		{ name: "half-wide", width: 800, height: 240, model: "og_plus" },
		{ name: "half-tall", width: 400, height: 480, model: "og_plus" },
		{ name: "trmnl-x", width: 1872, height: 1404, model: "v2" },
	];
	for (const layout of layouts) {
		let maxBytes = 0;
		for (const style of printStyles) {
			const baseModel = models.find((item) => item.name === layout.model);
			const model = {
				...baseModel,
				width: layout.width,
				height: layout.height,
				rotation: 0,
			};
			// Match firmware's X budget; the smaller slots use their canvas dimensions.
			if (layout.model === "v2") model.image_size_limit = 750_000;
			if (layout.name.startsWith("half")) model.css = undefined;
			const profile = { model, palette };
			const screen = createScreenProfile({
				width: layout.width,
				height: layout.height,
				model: baseModel,
				palette,
			});
			const params = paramsSchema.parse({
				style,
				date: "2026-11-11",
				seed: "",
			});
			const { png } = await rasterize({
				slug: definition.meta.slug,
				element: React.createElement(definition.Component, {
					screen,
					params,
					data: params,
				}),
				imageWidth: layout.width,
				imageHeight: layout.height,
				layoutWidth: screen.logicalWidth,
				layoutHeight: screen.logicalHeight,
				renderSettings: definition.meta.renderSettings,
				model,
				profile,
			});
			const encoded = await renderDeviceImage({ png, profile });
			assert.ok(
				!encoded.fallback && !encoded.size_limit_exceeded,
				`${style}/${layout.name} exceeded budget`,
			);
			const { data, info } = await sharp(encoded.buffer)
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			assert.deepEqual(
				[info.width, info.height],
				[layout.width, layout.height],
			);
			assert.ok(
				data.every((value) => value === 0 || value === 255),
				"Preview must be strictly black and white",
			);
			assert.ok(
				data.includes(0) && data.includes(255),
				"Preview must contain artwork",
			);
			maxBytes = Math.max(maxBytes, encoded.buffer.length);
			fs.writeFileSync(
				path.join(output, `${style}-${layout.name}.png`),
				encoded.buffer,
			);
			if (layout.name === "landscape") samples.set(style, encoded.buffer);
		}
		console.log(
			`Passed nine ${layout.name} renders; largest PNG ${maxBytes} bytes`,
		);
	}
	async function gallery(styles, filename, columns) {
		const gap = 16;
		const rows = Math.ceil(styles.length / columns);
		const width = columns * 800 + (columns + 1) * gap;
		const height = rows * 480 + (rows + 1) * gap;
		await sharp({
			create: { width, height, channels: 3, background: "#e4e3df" },
		})
			.composite(
				styles.map((style, index) => ({
					input: samples.get(style),
					left: gap + (index % columns) * (800 + gap),
					top: gap + Math.floor(index / columns) * (480 + gap),
				})),
			)
			.png()
			.toFile(path.join(screenshots, filename));
	}
	await gallery(printStyles.slice(3), "generative-print-variants.png", 2);
	await gallery(printStyles.slice(0, 3), "generative-print-classics.png", 1);
	console.log(`Individual device images: ${output}`);
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
