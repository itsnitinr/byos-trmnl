/**
 * Headless page smoke test: loads dashboard pages in real Chrome and reports
 * page errors, console errors, failed requests, 5xx responses and error
 * screens. Start BYOS first, then:
 *
 *   BASE_URL=http://127.0.0.1:3000 CHROME_EXECUTABLE_PATH=/path/to/chrome pnpm test:pages [paths...]
 *
 * Without paths it checks the main pages. Exits non-zero when a page has problems.
 */
const puppeteer = require("puppeteer-core");

const base = process.env.BASE_URL || "http://127.0.0.1:3000";
const executablePath = process.env.CHROME_EXECUTABLE_PATH;
const paths = process.argv.slice(2);
const defaultPaths = [
	"/",
	"/playlists",
	"/recipes",
	"/recipes/simple-text",
	"/system-logs",
	"/mixup",
	"/catalog",
	"/tools",
	"/tools/playlist-simulator",
	"/tools/render-inspector",
];
const errorMarkers = [
	"Application error",
	"Unhandled Runtime Error",
	"This page could not be found",
	"Internal Server Error",
];

async function main() {
	if (!executablePath) throw new Error("Set CHROME_EXECUTABLE_PATH");
	const browser = await puppeteer.launch({
		headless: true,
		executablePath,
		args: ["--no-sandbox", "--disable-dev-shm-usage"],
	});
	let failures = 0;
	try {
		for (const path of paths.length ? paths : defaultPaths) {
			const page = await browser.newPage();
			await page.setViewport({ width: 1400, height: 900 });
			const problems = [];
			page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
			page.on("console", (message) => {
				if (message.type() === "error")
					problems.push(`console: ${message.text().slice(0, 200)}`);
			});
			page.on("requestfailed", (request) => {
				// Server actions still streaming when the page closes are aborted by design.
				if (!request.headers()["next-action"])
					problems.push(`failed: ${request.url()} ${request.failure()?.errorText}`);
			});
			page.on("response", (response) => {
				if (response.status() >= 500)
					problems.push(`HTTP ${response.status()}: ${response.url()}`);
			});
			const started = Date.now();
			await page
				.goto(base + path, { waitUntil: "networkidle0", timeout: 45_000 })
				.catch((error) => problems.push(`navigation: ${error.message}`));
			const text = await page.evaluate(() => document.body?.innerText ?? "");
			for (const marker of errorMarkers)
				if (text.includes(marker)) problems.push(`text: "${marker}"`);
			console.log(`${problems.length ? "✗" : "✓"} ${path} (${Date.now() - started} ms)`);
			for (const problem of problems) console.log(`    ${problem}`);
			if (problems.length) failures++;
			await page.close();
		}
	} finally {
		await browser.close();
	}
	if (failures) {
		console.error(`${failures} page(s) had problems`);
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
