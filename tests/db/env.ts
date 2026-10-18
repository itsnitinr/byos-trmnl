const url = process.env.TEST_DATABASE_URL;
if (!url) {
	throw new Error(
		"TEST_DATABASE_URL is required for database tests. Point it at a throwaway database: the suites drop the public schema.",
	);
}
process.env.DATABASE_URL = url;
