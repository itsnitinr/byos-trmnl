import {
	restrictHtmlNetwork,
	withBrowserPage,
} from "@/lib/recipes/render/browser-page";
import { rewritePageImagesForDevice } from "@/lib/recipes/render/image-dither-intercept";
import {
	IMAGE_DITHER_OFF,
	type ImageDitherPolicy,
} from "@/lib/recipes/render/image-dither-policy";
import { waitForRenderReady } from "@/lib/recipes/render/readiness";
import { injectTrmnlCssIntoHtml } from "@/lib/trmnl/model-css";
import type { TrmnlModel } from "@/lib/trmnl/types";

/**
 * Render a complete HTML document to a PNG buffer using Puppeteer.
 *
 * Uses the "sandboxed" Chrome profile — web security stays ON because the
 * HTML originates from user-authored Liquid recipes in the DB.
 *
 * If `model` is provided, the model's `css.variables` (as `:root` custom
 * properties) and `css.classes` (merged onto the body element) are injected
 * before screenshotting, so plugins authored against the TRMNL framework CSS
 * contract render faithfully.
 */
export async function renderHtmlToImage(
	html: string,
	width: number,
	height: number,
	model?: TrmnlModel | null,
	imageDitherPolicy?: ImageDitherPolicy,
): Promise<Buffer> {
	return withBrowserPage("sandboxed", async (page) => {
		await page.setViewport({ width, height });
		await page.setContent(
			restrictHtmlNetwork(
				injectTrmnlCssIntoHtml(
					html.replaceAll(
						'"/trmnl-framework/',
						`"http://127.0.0.1:${process.env.PORT || 3000}/trmnl-framework/`,
					),
					model ?? null,
				),
			),
			{
				waitUntil: "load",
				timeout: 15000,
			},
		);
		await waitForRenderReady(page);
		const ditherPolicy = imageDitherPolicy ?? IMAGE_DITHER_OFF;
		await rewritePageImagesForDevice(page, ditherPolicy);
		if (ditherPolicy.mode !== "off") {
			await waitForRenderReady(page);
		}
		const screenshot = await page.screenshot({
			type: "png",
			clip: { x: 0, y: 0, width, height },
		});
		return Buffer.from(screenshot);
	});
}
