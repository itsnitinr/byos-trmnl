/** Real Chrome smoke checks. Start BYOS first, then run PORT=3011 pnpm test:browser. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const sharp = require("sharp");
const root = path.resolve(__dirname, "..");

// Load application TypeScript in this standalone Node process. This avoids mocking
// Puppeteer or changing the unit-test runner to accommodate its ESM dependencies.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, parent, ...args) {
	return resolve.call(
		this,
		name.startsWith("@/") ? path.join(root, name.slice(2)) : name,
		parent,
		...args,
	);
};
for (const ext of [".ts", ".tsx"])
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

async function main() {
	const { getBrowser } = require("../lib/recipes/chrome-pool.ts");
	const { renderHtmlToImage } = require("../lib/recipes/html-screenshot.ts");
	const {
		withBrowserPage,
		restrictHtmlNetwork,
	} = require("../lib/recipes/render/browser-page.ts");
	const { waitForRenderReady } = require("../lib/recipes/render/readiness.ts");
	const browser = await getBrowser("sandboxed");
	try {
		await withBrowserPage("sandboxed", async (page) => {
			const failed = [];
			page.on("requestfailed", (request) =>
				failed.push(new URL(request.url()).pathname),
			);
			await page.setContent(
				restrictHtmlNetwork(
					`<html><head><link rel="stylesheet" href="http://127.0.0.1:${process.env.PORT || 3000}/trmnl-framework/3.3.1/plugins.css"></head><body class="environment trmnl"><div class="screen"><span class="title">A printed object</span></div></body></html>`,
				),
				{ waitUntil: "load" },
			);
			await waitForRenderReady(page);
			const fonts = await page.evaluate(() =>
				Array.from(document.fonts)
					.filter((font) => font.status === "loaded")
					.map((font) => font.family),
			);
			assert.deepEqual(failed, [], "Bundled resources must all load");
			assert.ok(
				fonts.includes("TRMNL21"),
				"The actual framework font must load, not a fallback",
			);
		});
		const result = await renderHtmlToImage(
			'<html><head></head><body style="margin:0;background:white"><div style="width:80px;height:80px;background:black"></div></body></html>',
			200,
			100,
		);
		const { data, info } = await sharp(result)
			.removeAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		assert.deepEqual([info.width, info.height], [200, 100]);
		assert.equal(data[0], 0);
		assert.equal(data[(99 * 200 + 199) * 3], 255);
		await withBrowserPage("sandboxed", async (page) => {
			await page.setContent(
				restrictHtmlNetwork('<img src="http://127.0.0.1:9/private">'),
				{ waitUntil: "load" },
			);
			assert.equal(
				await page.evaluate(() => document.images[0].naturalWidth),
				0,
			);
		});
		console.log(
			"Passed bundled font loading, screenshot pixels and private-resource blocking.",
		);
	} finally {
		if (process.env.BROWSER_URL || process.env.BROWSER_WS_ENDPOINT)
			browser.disconnect();
		else await browser.close();
	}
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
