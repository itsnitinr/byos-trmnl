import type { Page } from "puppeteer-core";

/** Wait for actual content readiness, rather than hoping a network-idle interval was enough. */
export async function waitForRenderReady(
	page: Page,
	recipeMarker = false,
): Promise<void> {
	if (recipeMarker)
		await page.waitForSelector('[data-recipe-ready="true"]', {
			timeout: 15_000,
		});
	await page.addStyleTag({
		content:
			"*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
	});
	await page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.all(
			Array.from(document.images).map(async (image) => {
				if (image.loading === "lazy") image.loading = "eager";
				await image.decode();
				if (!image.naturalWidth) throw new Error("Recipe image did not decode");
			}),
		);
		for (const animation of document.getAnimations()) animation.cancel();
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
	});
}
