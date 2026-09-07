import { createHash } from "node:crypto";
export type RenderedImageResponse = {
	buffer: Buffer;
	mime_type: string;
	size_limit_exceeded?: boolean;
	cacheStatus?: string;
	fallback?: boolean;
};

export function imageResponse(
	image: RenderedImageResponse,
	status = 200,
	request?: Request,
): Response {
	if (image.size_limit_exceeded)
		return Response.json(
			{ error: "Device image budget exceeded" },
			{ status: 422 },
		);
	const etag = `"${createHash("sha256").update(image.buffer).digest("hex")}"`;
	if (status === 200 && request?.headers.get("if-none-match") === etag) {
		return new Response(null, {
			status: 304,
			headers: { ETag: etag, "Cache-Control": "private, no-cache" },
		});
	}
	return new Response(new Uint8Array(image.buffer), {
		status,
		headers: {
			"Content-Type": image.mime_type,
			...(image.fallback ? { "X-TRMNL-Fallback": "image-budget" } : {}),
			"Cache-Control": status === 200 ? "private, no-cache" : "no-store",
			ETag: etag,
			...(image.cacheStatus ? { "X-TRMNL-Cache": image.cacheStatus } : {}),
			"Content-Length": image.buffer.length.toString(),
			...(image.size_limit_exceeded
				? { "X-TRMNL-Image-Size-Limit-Exceeded": "true" }
				: {}),
		},
	});
}
