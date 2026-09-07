import { withExplicitUserScope } from "@/lib/database/scoped-db";
import { loadLiquidRecipeSource, renderLiquidRecipe } from "./liquid-renderer";

jest.mock("@/lib/database/db", () => ({ db: {} }));
jest.mock("@/lib/database/utils", () => ({
	checkDbConnection: async () => ({ ready: true }),
}));
jest.mock("@/lib/database/scoped-db", () => ({
	withExplicitUserScope: jest.fn(),
}));
jest.mock("@/lib/auth/get-user", () => ({ getCurrentUserId: jest.fn() }));
jest.mock("./runtime/refresh-settings", () => ({
	loadRecipeRefreshSettings: jest.fn(),
}));

test("Liquid source files are loaded once and reused for settings and rendering", async () => {
	const execute = jest.fn(async () => [
		{
			filename: "full.liquid",
			content:
				"<h1>{{ trmnl.plugin_settings.custom_fields_values.title }}</h1>",
		},
		{ filename: "settings.yml", content: "name: Example" },
	]);
	const query = {
		selectFrom: () => query,
		innerJoin: () => query,
		select: () => query,
		where: () => query,
		execute,
	};
	jest
		.mocked(withExplicitUserScope)
		.mockImplementation(async (_user, callback) => callback(query as never));
	const source = await loadLiquidRecipeSource("fixture", "alice");
	if (!source) throw Error("Missing fixture");
	const result = await renderLiquidRecipe(
		"fixture",
		{ title: "One read" },
		"alice",
		source,
	);
	expect(result?.html).toContain("<h1>One read</h1>");
	expect(execute).toHaveBeenCalledTimes(1);
	expect(withExplicitUserScope).toHaveBeenCalledWith(
		"alice",
		expect.any(Function),
	);
});
