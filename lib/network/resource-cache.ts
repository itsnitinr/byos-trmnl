import { BoundedCache } from "@/lib/cache/bounded-cache";
import { fetchPublicResource, type PublicResource } from "./public-fetch";

const resources = new BoundedCache<PublicResource>(32 * 1024 * 1024);
function lifetime(headers: Record<string, string>): number {
	const control = headers["cache-control"] ?? "";
	if (/\b(?:no-cache|no-store|private)\b/i.test(control)) return 0;
	const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control);
	const remaining = maxAge
		? Math.max(0, Number(maxAge[1]) - Number(headers.age || 0)) * 1000
		: 30_000;
	return Math.min(30_000, remaining);
}
/** Public assets only, with no cookies or credentials. Short TTL, upstream cache directives and bounded memory. */
export async function cachedPublicResource(
	url: string,
): Promise<PublicResource> {
	const previous = resources.peek(url);
	const result = await resources.get(
		url,
		previous ? lifetime(previous.value.headers) : 30_000,
		() => fetchPublicResource(url),
		(resource) => resource.body.length,
	);
	if (lifetime(result.value.headers) === 0) resources.delete(url);
	return result.value;
}
