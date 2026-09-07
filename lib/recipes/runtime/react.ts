import { cache } from "react";
import { z } from "zod";
import { getScreenParams } from "@/app/actions/screens-params";
import { getCurrentUserId } from "@/lib/auth/get-user";
import { getReactRecipeDefinition } from "@/lib/recipes/registry";
import type { AnyRecipeDefinition } from "@/lib/recipes/types";
import { zodObjectToParamDefinitions } from "@/lib/recipes/zod-form";
import {
	type DataFreshness,
	recipeDataKey,
	resolveCachedData,
} from "./data-cache";
import { withRecipeDeadline } from "./fetch-context";
import { loadRecipeRefreshSettings } from "./refresh-settings";

/**
 * React-recipe runtime: given a slug + (optional) userId, resolve the
 * recipe's definition, validated user params, and the data the component
 * should render against.
 *
 * The flow is:
 *   1) Look up the recipe in the in-process registry (no DB).
 *   2) Read user-saved overrides from `screen_configs` (the only DB read).
 *   3) Parse those overrides through `paramsSchema` so:
 *        - unknown keys are stripped
 *        - missing keys get their schema default
 *        - invalid stored shapes are logged, then reset to schema defaults
 *   4) If the definition has a `getData(params)`, call it; otherwise the
 *      data IS the params (paramsSchema.parse gives us a fully-defaulted
 *      object).
 *   5) Validate the data through `dataSchema` the same way (defaults +
 *      strip).
 */

export type ResolvedReactRecipe = {
	definition: AnyRecipeDefinition;
	params: Record<string, unknown>;
	data: Record<string, unknown>;
	freshness?: DataFreshness;
};

function safeParseWithDefaults(
	schema: z.ZodObject,
	value: unknown,
	context: string,
): Record<string, unknown> {
	const candidate =
		value && typeof value === "object" && !Array.isArray(value) ? value : {};
	const result = schema.safeParse(candidate);
	if (result.success) return result.data as Record<string, unknown>;
	// Stored shape no longer matches the schema (e.g. field renamed). Report it
	// and render from the schema-defined defaults so the device shows a valid UI.
	console.warn(`[recipe:${context}] Stored params failed schema validation`, {
		issues: result.error.issues,
	});
	const defaults = schema.safeParse({});
	return defaults.success ? (defaults.data as Record<string, unknown>) : {};
}

function safeParseDataWithDefaults(
	schema: z.ZodTypeAny,
	value: unknown,
): Record<string, unknown> {
	const result = schema.safeParse(value);
	if (result.success) {
		const data = result.data;
		return data && typeof data === "object" && !Array.isArray(data)
			? (data as Record<string, unknown>)
			: {};
	}
	console.warn("[recipe:data] Data failed schema validation", {
		issues: result.error.issues,
	});
	const defaults = schema.safeParse({});
	if (defaults.success) {
		const data = defaults.data;
		return data && typeof data === "object" && !Array.isArray(data)
			? (data as Record<string, unknown>)
			: {};
	}
	return {};
}

export const resolveReactRecipe = cache(
	async (
		slug: string,
		userId?: string,
	): Promise<ResolvedReactRecipe | null> => {
		userId ??= (await getCurrentUserId()) ?? undefined;
		const definition = await getReactRecipeDefinition(slug);
		if (!definition) return null;

		// Read user-saved param overrides. Pass paramDefinitions so
		// getScreenParams can return only fields declared by the recipe schema.
		const paramDefinitions = zodObjectToParamDefinitions(
			definition.paramsSchema,
		);
		const storedOverrides =
			Object.keys(paramDefinitions).length > 0
				? await getScreenParams(slug, paramDefinitions, userId)
				: {};

		const params = safeParseWithDefaults(
			definition.paramsSchema,
			storedOverrides,
			slug,
		);

		let data: Record<string, unknown>;
		let freshness: DataFreshness | undefined;
		if (definition.getData) {
			const getData = definition.getData;
			const refresh = await loadRecipeRefreshSettings(slug, userId);
			const result = await resolveCachedData(
				recipeDataKey(userId, slug, {
					params,
					version: definition.meta.version,
				}),
				async () => {
					const fetched = await withRecipeDeadline((signal) =>
						getData(params, { signal }),
					);
					const validated = definition.dataSchema.parse(fetched);
					if (
						!validated ||
						typeof validated !== "object" ||
						Array.isArray(validated)
					)
						throw new Error("Recipe data must be an object");
					return validated as Record<string, unknown>;
				},
				refresh.seconds * 1000,
			);
			data = result.data;
			freshness = result.freshness;
		} else {
			data = safeParseDataWithDefaults(definition.dataSchema, params);
		}

		return { definition, params, data, freshness };
	},
);
