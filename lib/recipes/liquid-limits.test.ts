import { createLiquidEngine, LIQUID_LIMITS } from "./liquid-renderer";

jest.mock("@/lib/database/db", () => ({ db: {} }));
jest.mock("@/lib/database/utils", () => ({
	checkDbConnection: async () => ({ ready: true }),
}));
jest.mock("@/lib/database/scoped-db", () => ({}));
jest.mock("@/lib/auth/get-user", () => ({ getCurrentUserId: jest.fn() }));

test("renders ordinary templates", async () => {
	const engine = createLiquidEngine();
	await expect(
		engine.parseAndRender(
			"{% for i in (1..3) %}{{ i }}{% endfor %} {{ missing }}",
			{},
		),
	).resolves.toBe("123 ");
});

test("stops runaway loops instead of blocking the server", async () => {
	const engine = createLiquidEngine();
	const started = Date.now();
	await expect(
		engine.parseAndRender(
			"{% for i in (1..1000000000) %}{{ i }}{% endfor %}",
			{},
		),
	).rejects.toThrow();
	expect(Date.now() - started).toBeLessThan(LIQUID_LIMITS.renderLimit + 5_000);
});

test("rejects oversized templates", async () => {
	const engine = createLiquidEngine();
	await expect(
		engine.parseAndRender("x".repeat(LIQUID_LIMITS.parseLimit + 1), {}),
	).rejects.toThrow();
});

test("callers cannot lift the limits", () => {
	const engine = createLiquidEngine({ renderLimit: Number.POSITIVE_INFINITY });
	expect(engine.options.renderLimit).toBe(LIQUID_LIMITS.renderLimit);
});
