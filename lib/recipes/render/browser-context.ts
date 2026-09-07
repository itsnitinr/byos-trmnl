import crypto from "node:crypto";

export type BrowserRenderContext = {
	userId: string | null;
	slug: string;
	expiresAt: number;
};

// Authenticated deployments share their configured secret across server bundles.
// Mono-user deployments only need a process-local key for loopback captures.
const state = globalThis as typeof globalThis & { byosRenderSecret?: string };
function secret(): string {
	if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
	state.byosRenderSecret ??= crypto.randomBytes(32).toString("hex");
	return state.byosRenderSecret;
}

const TTL_MS = 30_000;

export function createBrowserRenderContext(
	userId: string | null | undefined,
	slug: string,
): string {
	const payload = Buffer.from(
		JSON.stringify({
			userId: userId ?? null,
			slug,
			expiresAt: Date.now() + TTL_MS,
		}),
	).toString("base64url");
	const signature = crypto
		.createHmac("sha256", secret())
		.update(payload)
		.digest("base64url");
	return `${payload}.${signature}`;
}

export function readBrowserRenderContext(
	token: string,
	slug: string,
): BrowserRenderContext | null {
	if (token.length > 4096) return null;
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra) return null;
	const expected = crypto
		.createHmac("sha256", secret())
		.update(payload)
		.digest();
	const supplied = Buffer.from(signature, "base64url");
	if (
		expected.length !== supplied.length ||
		!crypto.timingSafeEqual(expected, supplied)
	)
		return null;
	try {
		const context = JSON.parse(
			Buffer.from(payload, "base64url").toString(),
		) as BrowserRenderContext;
		if (
			context.slug !== slug ||
			typeof context.expiresAt !== "number" ||
			context.expiresAt <= Date.now() ||
			(context.userId !== null && typeof context.userId !== "string")
		)
			return null;
		return context;
	} catch {
		return null;
	}
}
