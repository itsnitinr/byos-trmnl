/**
 * Boot-time sanity check of environment configuration. Problems are reported
 * with the fix, instead of surfacing later as an opaque failure (better-auth,
 * for example, only throws on the first sign-in when its secret is missing).
 */

export type ConfigProblem = {
	level: "error" | "warn";
	message: string;
};

type Env = Record<string, string | undefined>;

const CHOICES: Record<string, readonly string[]> = {
	REACT_RENDERER: ["takumi", "satori", "browser"],
	FIRMWARE_UPDATES: ["auto", "off"],
	LOG_DB_LEVEL: ["debug", "info", "warn", "error", "off", "none"],
	AUTH_ENABLED: ["true", "false"],
	AUTO_MIGRATE: ["true", "false"],
	DATABASE_SSL: ["false", "verify"],
};

export function checkRuntimeConfig(env: Env = process.env): ConfigProblem[] {
	const problems: ConfigProblem[] = [];
	const authEnabled = env.AUTH_ENABLED !== "false";
	const production = env.NODE_ENV === "production";

	if (!env.DATABASE_URL) {
		problems.push({
			level: "warn",
			message:
				"DATABASE_URL is not set: running in no-DB preview mode (devices, playlists and logs are disabled).",
		});
	}

	if (authEnabled && !env.BETTER_AUTH_SECRET) {
		problems.push({
			level: production ? "error" : "warn",
			message:
				"Authentication is enabled but BETTER_AUTH_SECRET is not set; sign-in will fail in production. Generate one with `openssl rand -base64 32`, or set AUTH_ENABLED=false for single-user mode.",
		});
	} else if (
		authEnabled &&
		env.BETTER_AUTH_SECRET &&
		env.BETTER_AUTH_SECRET.length < 32
	) {
		problems.push({
			level: "warn",
			message:
				"BETTER_AUTH_SECRET is shorter than 32 characters. Generate one with `openssl rand -base64 32`.",
		});
	}

	if (
		authEnabled &&
		production &&
		!env.BETTER_AUTH_URL &&
		!env.VERCEL_URL &&
		!env.VERCEL_PROJECT_PRODUCTION_URL
	) {
		problems.push({
			level: "warn",
			message:
				"BETTER_AUTH_URL is not set; auth origin checks and password-reset links assume http://localhost:3000. Set it to this server's public URL.",
		});
	}

	if (env.BETTER_AUTH_URL && !URL.canParse(env.BETTER_AUTH_URL)) {
		problems.push({
			level: "error",
			message: `BETTER_AUTH_URL is not a valid URL: ${env.BETTER_AUTH_URL}`,
		});
	}

	for (const [name, allowed] of Object.entries(CHOICES)) {
		const value = env[name];
		if (value && !allowed.includes(value.toLowerCase())) {
			problems.push({
				level: "warn",
				message: `${name}=${value} is not recognised (expected ${allowed.join(" | ")}); the default is used.`,
			});
		}
	}

	const retention = env.LOG_RETENTION_DAYS;
	if (retention && retention !== "0") {
		const days = Number(retention);
		if (!Number.isInteger(days) || days < 1 || days > 3650) {
			problems.push({
				level: "warn",
				message: `LOG_RETENTION_DAYS=${retention} is ignored (expected a whole number of days between 1 and 3650, or 0 to keep logs).`,
			});
		}
	}

	return problems;
}

export function reportRuntimeConfig(env: Env = process.env): void {
	for (const problem of checkRuntimeConfig(env)) {
		const line = `[config] ${problem.message}`;
		if (problem.level === "error") console.error(line);
		else console.warn(line);
	}
}
