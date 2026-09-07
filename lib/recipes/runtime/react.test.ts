import { z } from "zod";
import { getReactRecipeDefinition } from "../registry";
import { loadRecipeConfig } from "./config";
import { resolveReactRecipe } from "./react";

jest.mock("./config", () => ({ loadRecipeConfig: jest.fn() }));
jest.mock("../registry", () => ({ getReactRecipeDefinition: jest.fn() }));
jest.mock("@/lib/auth/get-user", () => ({ getCurrentUserId: jest.fn() }));

test("one configuration read supplies both schema-validated params and data freshness", async () => {
	jest.mocked(loadRecipeConfig).mockResolvedValue({
		params: { city: "London", extra: "stripped" },
		dataRefreshSeconds: 0,
		editable: true,
	});
	const getData = jest.fn(async ({ city }) => ({ text: city }));
	jest.mocked(getReactRecipeDefinition).mockResolvedValue({
		meta: { slug: "fixture", title: "Fixture" },
		paramsSchema: z.object({ city: z.string().default("Paris") }),
		dataSchema: z.object({ text: z.string() }),
		getData,
		Component: () => null,
	});
	const result = await resolveReactRecipe("fixture", "alice");
	expect(result?.params).toEqual({ city: "London" });
	expect(result?.data).toEqual({ text: "London" });
	expect(loadRecipeConfig).toHaveBeenCalledTimes(1);
	expect(loadRecipeConfig).toHaveBeenCalledWith("fixture", "alice");
	expect(getData).toHaveBeenCalledTimes(1);
});
