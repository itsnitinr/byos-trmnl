import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
	["2001:db8::", 32],
	["2001::", 32],
	["2002::", 16],
] as const)
	blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 4) return !blocked.check(address, "ipv4");
	return (
		family === 6 &&
		globalV6.check(address, "ipv6") &&
		!blocked.check(address, "ipv6")
	);
}

export async function resolvePublicUrl(input: string) {
	const url = new URL(input);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password
	)
		throw new Error("Only public HTTP(S) resources are allowed");
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const literalFamily = isIP(hostname);
	const addresses = literalFamily
		? [{ address: hostname, family: literalFamily }]
		: await lookup(hostname, { all: true });
	if (
		!addresses.length ||
		addresses.some(({ address }) => !isPublicAddress(address))
	)
		throw new Error("Private network resources are not allowed");
	return { url, address: addresses[0] };
}

export type PublicResource = {
	body: Buffer;
	status: number;
	headers: Record<string, string>;
	url: string;
};

/** Validate every redirect and pin the resolved IP at connection time to prevent DNS rebinding. */
export async function fetchPublicResource(
	input: string,
	options: { maxBytes?: number; signal?: AbortSignal; redirects?: number } = {},
): Promise<PublicResource> {
	const signal = AbortSignal.any([
		AbortSignal.timeout(10_000),
		...(options.signal ? [options.signal] : []),
	]);
	const resolved = await resolvePublicUrl(input);
	signal.throwIfAborted();
	const maxBytes = options.maxBytes ?? 15 * 1024 * 1024;
	const result = await new Promise<PublicResource>((resolve, reject) => {
		const request = (resolved.url.protocol === "https:" ? https : http).get(
			resolved.url,
			{
				signal,
				agent: false,
				headers: { "User-Agent": "BYOS/1.0", "Accept-Encoding": "identity" },
				lookup: (_hostname, lookupOptions, callback) => {
					if (lookupOptions.all) callback(null, [resolved.address]);
					else
						callback(null, resolved.address.address, resolved.address.family);
				},
			},
			(response) => {
				const headers: Record<string, string> = {};
				for (const [key, value] of Object.entries(response.headers))
					if (
						typeof value === "string" &&
						!["set-cookie", "connection", "transfer-encoding"].includes(key)
					)
						headers[key] = value;
				const status = response.statusCode ?? 502;
				if (status >= 300 && status < 400 && headers.location) {
					response.destroy();
					resolve({ body: Buffer.alloc(0), status, headers, url: input });
					return;
				}
				if (Number(headers["content-length"]) > maxBytes) {
					response.destroy(new Error("Download exceeds byte limit"));
				}
				const chunks: Buffer[] = [];
				let bytes = 0;
				response.on("data", (chunk: Buffer) => {
					bytes += chunk.length;
					if (bytes > maxBytes)
						response.destroy(new Error("Download exceeds byte limit"));
					else chunks.push(chunk);
				});
				response.on("end", () =>
					resolve({ body: Buffer.concat(chunks), status, headers, url: input }),
				);
				response.on("error", reject);
			},
		);
		request.on("error", reject);
	});
	if (result.status >= 300 && result.status < 400 && result.headers.location) {
		const redirects = options.redirects ?? 3;
		if (redirects <= 0) throw new Error("Too many redirects");
		return fetchPublicResource(new URL(result.headers.location, input).href, {
			...options,
			signal,
			redirects: redirects - 1,
		});
	}
	if (result.status < 200 || result.status >= 300)
		throw new Error(`Resource returned HTTP ${result.status}`);
	return result;
}
