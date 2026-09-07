"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/auth/get-user";
import { withExplicitUserScope } from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";
import { isLiquidRecipe } from "@/lib/recipes/liquid-renderer";
import { isReactRecipe } from "@/lib/recipes/registry";
import { invalidateRecipeData } from "@/lib/recipes/runtime/data-cache";
import { loadRecipeRefreshSettings } from "@/lib/recipes/runtime/refresh-settings";

export async function getRecipeRefreshSettings(slug: string) {
	return loadRecipeRefreshSettings(slug, await getCurrentUserId());
}
export async function saveRecipeRefreshSettings(
	slug: string,
	seconds: number,
): Promise<{ success: boolean; error?: string }> {
	const userId = await getCurrentUserId();
	if (!userId) return { success: false, error: "Sign in to save settings" };
	if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400)
		return { success: false, error: "Choose 0–86400 seconds" };
	if (!(await checkDbConnection()).ready)
		return {
			success: false,
			error: "Initialize the database and apply migrations to save settings",
		};
	if (!isReactRecipe(slug) && !(await isLiquidRecipe(slug, userId)))
		return { success: false, error: "Recipe not found" };
	await withExplicitUserScope(userId, (db) =>
		db
			.insertInto("screen_configs")
			.values({
				screen_id: slug,
				user_id: userId,
				params: {},
				data_refresh_seconds: seconds,
			})
			.onConflict((oc) =>
				oc
					.columns(["screen_id", "user_id"])
					.where("user_id", "is not", null)
					.doUpdateSet({
						data_refresh_seconds: seconds,
						updated_at: new Date(),
					}),
			)
			.execute(),
	);
	invalidateRecipeData(userId, slug);
	revalidatePath(`/recipes/${slug}`);
	return { success: true };
}
