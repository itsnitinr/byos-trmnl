/** Render reproducible recipe previews without a server, database, or external services.
 * Run: node scripts/preview-flyover.cjs [individual-image-directory]
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
	} = require("../app/(app)/recipes/screens/flyover/flyover.tsx");
	const { createScreenProfile } = require("../lib/trmnl/screen-profile.ts");
	const { rasterize } = require("../lib/recipes/render/rasterize.ts");
	const { renderDeviceImage } = require("../lib/render/device-image.ts");
	const models = JSON.parse(
		fs.readFileSync(path.join(root, "data/trmnl/models.json")),
	).data;
	const palettes = JSON.parse(
		fs.readFileSync(path.join(root, "data/trmnl/palettes.json")),
	).data;
	const fixture = require("./fixtures/flyover-iss.json");
	const output = path.resolve(process.argv[2] || "/tmp/byos-flyover");
	fs.mkdirSync(output, { recursive: true });
	const layouts = [
		{
			name: "landscape",
			width: 800,
			height: 480,
			model: "og_plus",
			palette: "bw",
		},
		{
			name: "portrait",
			width: 480,
			height: 800,
			model: "og_plus",
			palette: "bw",
		},
		{
			name: "half-wide",
			width: 800,
			height: 240,
			model: "og_plus",
			palette: "bw",
		},
		{
			name: "half-tall",
			width: 400,
			height: 480,
			model: "og_plus",
			palette: "bw",
		},
		{
			name: "trmnl-x",
			width: 1872,
			height: 1404,
			model: "v2",
			palette: "gray-16",
		},
	];
	const live = process.env.FLYOVER_LIVE === "1";
	for (const view of ["iss", "place", "sun"]) {
		const params = paramsSchema.parse({ view, clouds: live });
		// Deterministic orbit fixture; everything after acquisition uses the real
		// getData, component, rasterizer, and device encoder. No DB or network.
		const originalFetch = globalThis.fetch;
		const originalNow = Date.now;
		let data;
		try {
			if (!live) {
				Date.now = () => Date.parse("2026-11-11T06:30:00Z");
				globalThis.fetch = async () => Response.json([fixture]);
			}
			data = definition.dataSchema.parse(await definition.getData(params));
			console.log(
				`${view} snapshot: ${new Date(data.updatedAt).toISOString()}; orbit: ${data.epoch}; clouds: ${data.cloudDate || "bundled fallback"}`,
			);
		} finally {
			Date.now = originalNow;
			globalThis.fetch = originalFetch;
		}
		for (const layout of layouts) {
			const baseModel = models.find((item) => item.name === layout.model);
			const palette = palettes.find((item) => item.id === layout.palette);
			assert.ok(palette, `Missing palette ${layout.palette}`);
			const model = {
				...baseModel,
				width: layout.width,
				height: layout.height,
				rotation: 0,
			};
			if (layout.model === "v2") model.image_size_limit = 750_000;
			if (layout.name.startsWith("half")) model.css = undefined;
			const profile = { model, palette };
			const screen = createScreenProfile({
				width: layout.width,
				height: layout.height,
				model: baseModel,
				palette,
			});
			const { png } = await rasterize({
				slug: definition.meta.slug,
				element: React.createElement(definition.Component, {
					screen,
					params,
					data,
				}),
				imageWidth: layout.width,
				imageHeight: layout.height,
				layoutWidth: screen.logicalWidth,
				layoutHeight: screen.logicalHeight,
				renderSettings: definition.meta.renderSettings,
				model,
				profile,
			});
			const encoded = await renderDeviceImage({
				png,
				profile,
				reductionMode: definition.meta.renderSettings.paletteReduction,
			});
			assert.ok(
				!encoded.fallback && !encoded.size_limit_exceeded,
				`${view}/${layout.name} exceeded firmware budget`,
			);
			const raw = await sharp(encoded.buffer)
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			assert.deepEqual(
				[raw.info.width, raw.info.height],
				[layout.width, layout.height],
			);
			if (layout.palette === "bw")
				assert.ok(raw.data.every((value) => value === 0 || value === 255));
			fs.writeFileSync(
				path.join(output, `${view}-${layout.name}.png`),
				encoded.buffer,
			);
			console.log(
				`Passed ${view}/${layout.name}: ${encoded.buffer.length} bytes`,
			);
		}
	}
	if (!live)
		fs.copyFileSync(
			path.join(output, "iss-landscape.png"),
			path.join(root, "docs/screenshots/flyover.png"),
		);
	console.log(`Device previews: ${output}`);
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
