import { loadRecipeConfig } from "./config";

const DEFAULTS: Record<string, number> = {
	weather: 900,
	"air-quality": 900,
	"bitcoin-price": 300,
	"hacker-news": 300,
	"local-news": 600,
	wikipedia: 86400,
	calendar: 300,
	"github-contributions": 900,
	"whos-overhead": 30,
	"sunrise-sunset": 3600,
};
export function defaultDataRefreshSeconds(slug: string): number {
	return DEFAULTS[slug] ?? 300;
}

export async function loadRecipeRefreshSettings(
	slug: string,
	userId?: string | null,
): Promise<{ seconds: number; editable: boolean }> {
	const fallback = {
		seconds: defaultDataRefreshSeconds(slug),
		editable: false,
	};
	if (!userId) return fallback;
	const config = await loadRecipeConfig(slug, userId);
	return {
		seconds: config.dataRefreshSeconds ?? fallback.seconds,
		editable: config.editable,
	};
}
