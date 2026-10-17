import { checkRuntimeConfig } from "./config";

const base = {
	NODE_ENV: "production",
	DATABASE_URL: "postgres://db",
	BETTER_AUTH_SECRET: "x".repeat(40),
	BETTER_AUTH_URL: "https://trmnl.example.com",
};

test("a complete production configuration has no problems", () => {
	expect(checkRuntimeConfig(base)).toEqual([]);
});

test("missing auth secret is an error in production only", () => {
	const { BETTER_AUTH_SECRET: _secret, ...withoutSecret } = base;
	expect(checkRuntimeConfig(withoutSecret)).toEqual([
		expect.objectContaining({
			level: "error",
			message: expect.stringContaining("BETTER_AUTH_SECRET"),
		}),
	]);
	expect(
		checkRuntimeConfig({ ...withoutSecret, NODE_ENV: "development" })[0].level,
	).toBe("warn");
	expect(
		checkRuntimeConfig({ ...withoutSecret, AUTH_ENABLED: "false" }),
	).toEqual([]);
});

test("flags unknown option values and invalid numbers", () => {
	const messages = checkRuntimeConfig({
		...base,
		REACT_RENDERER: "chrome",
		FIRMWARE_UPDATES: "never",
		LOG_RETENTION_DAYS: "thirty",
		BETTER_AUTH_URL: "not a url",
	}).map((problem) => problem.message);
	expect(messages).toEqual(
		expect.arrayContaining([
			expect.stringContaining("REACT_RENDERER=chrome"),
			expect.stringContaining("FIRMWARE_UPDATES=never"),
			expect.stringContaining("LOG_RETENTION_DAYS=thirty"),
			expect.stringContaining("BETTER_AUTH_URL is not a valid URL"),
		]),
	);
});

test("no database means preview mode", () => {
	const { DATABASE_URL: _url, ...withoutDb } = base;
	expect(checkRuntimeConfig(withoutDb)).toEqual([
		expect.objectContaining({ message: expect.stringContaining("no-DB") }),
	]);
});
