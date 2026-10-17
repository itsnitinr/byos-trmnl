import { getReactRecipeDefinition } from "@/lib/recipes/registry";
import { loadRecipeConfig } from "./config";

export const DEFAULT_DATA_REFRESH_SECONDS = 300;

/** The recipe's declared data lifetime (`meta.dataRefreshSeconds`), else 300 s. */
export async function defaultDataRefreshSeconds(slug: string): Promise<number> {
	const definition = await getReactRecipeDefinition(slug);
	return definition?.meta.dataRefreshSeconds ?? DEFAULT_DATA_REFRESH_SECONDS;
}

export async function loadRecipeRefreshSettings(
	slug: string,
	userId?: string | null,
): Promise<{ seconds: number; editable: boolean }> {
	const fallback = {
		seconds: await defaultDataRefreshSeconds(slug),
		editable: false,
	};
	if (!userId) return fallback;
	const config = await loadRecipeConfig(slug, userId);
	return {
		seconds: config.dataRefreshSeconds ?? fallback.seconds,
		editable: config.editable,
	};
}
