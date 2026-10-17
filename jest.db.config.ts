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
		"^@/(.*)$": "<rootDir>/$1",
	},
	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				tsconfig: {
					rootDir: ".",
					moduleResolution: "node16",
					module: "node16",
				},
			},
		],
	},
};

export default config;
