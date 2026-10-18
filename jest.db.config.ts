import type { Config } from "jest";

/**
 * Integration tests against a real Postgres. Opt-in: set TEST_DATABASE_URL to a
 * throwaway database. The suites drop and recreate the public schema.
 */
const config: Config = {
	preset: "ts-jest",
	testEnvironment: "node",
	testMatch: ["**/*.db.test.ts"],
	modulePathIgnorePatterns: ["<rootDir>/\\.next[^/]*/"],
	testPathIgnorePatterns: ["/node_modules/", "/\\.next[^/]*/"],
	setupFiles: ["<rootDir>/tests/db/env.ts"],
	maxWorkers: 1,
	testTimeout: 60_000,
	moduleNameMapper: {
		"^next/font/(google|local)$": "<rootDir>/tests/mocks/next-font.ts",
		"^@/(.*)$": "<rootDir>/$1",
	},
	// Kysely ships ESM only; compile it to CommonJS like the TypeScript sources.
	transformIgnorePatterns: ["/node_modules/(?!\\.pnpm/kysely@)(?!kysely/)"],
	transform: {
		"^.+\\.(tsx?|js)$": [
			"ts-jest",
			{
				tsconfig: {
					rootDir: ".",
					allowJs: true,
					// CommonJS so recipe loaders' dynamic import() becomes require()
					// (Jest's module runtime cannot execute import()).
					moduleResolution: "node10",
					module: "commonjs",
					ignoreDeprecations: "6.0",
				},
			},
		],
	},
};

export default config;
