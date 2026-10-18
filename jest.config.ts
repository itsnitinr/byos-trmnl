import type { Config } from "jest";

const config: Config = {
	preset: "ts-jest",
	testEnvironment: "node",
	modulePathIgnorePatterns: ["<rootDir>/\\.next[^/]*/"],
	// Database integration tests run separately: pnpm test:db (jest.db.config.ts).
	testPathIgnorePatterns: [
		"/node_modules/",
		"/\\.next[^/]*/",
		"\\.db\\.test\\.ts$",
	],
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
