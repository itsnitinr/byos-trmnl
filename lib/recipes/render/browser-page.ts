import type { Page } from "puppeteer-core";
import { fetchPublicResource } from "@/lib/network/public-fetch";
import { type ChromeProfile, getBrowser } from "../chrome-pool";
import { browserQueue } from "./browser-queue";

export async function withBrowserPage<T>(
	profile: ChromeProfile,
	work: (page: Page) => Promise<T>,
	previewUrl?: string,
): Promise<T> {
	return browserQueue.run(async (signal) => {
		const browser = await getBrowser(profile);
		signal.throwIfAborted();
		const context = await browser.createBrowserContext();
		const close = () => {
			void context.close().catch(() => undefined);
		};
		signal.addEventListener("abort", close, { once: true });
		try {
			signal.throwIfAborted();
			const page = await context.newPage();
			page.setDefaultTimeout(15_000);
			await page.setBypassServiceWorker(true);
			context.on("targetcreated", async (target) => {
				if (target.type() === "page") {
					const popup = await target.page();
					if (popup && popup !== page)
						await popup.close().catch(() => undefined);
				}
			});
			await page.setRequestInterception(true);
			page.on("request", (request) => {
				void (async () => {
					const url = new URL(request.url());
					if (["data:", "about:", "blob:"].includes(url.protocol)) {
						await request.continue();
						return;
					}
					if (
						previewUrl &&
						url.origin === new URL(previewUrl).origin &&
						(request.url() === previewUrl ||
							/^\/(?:_next|fonts|trmnl-icons)\//.test(url.pathname))
					) {
						await request.continue();
						return;
					}
					if (
						request.isNavigationRequest() ||
						!["GET", "HEAD"].includes(request.method())
					) {
						await request.abort();
						return;
					}
					const resource = await fetchPublicResource(request.url(), { signal });
					await request.respond({
						status: resource.status,
						headers: resource.headers,
						body: resource.body,
					});
				})().catch(async () => {
					if (!request.isInterceptResolutionHandled())
						await request.abort().catch(() => undefined);
				});
			});
			return await work(page);
		} finally {
			signal.removeEventListener("abort", close);
			await context.close().catch(() => undefined);
		}
	});
}

export function restrictHtmlNetwork(html: string): string {
	const policy =
		"default-src 'none'; img-src data: https: http:; font-src data: https: http:; style-src 'unsafe-inline' https: http:; script-src 'unsafe-inline' https: http:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
	const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
	return /<head[^>]*>/i.test(html)
		? html.replace(/<head[^>]*>/i, (match) => match + meta)
		: meta + html;
}
