export class ByteLimitError extends Error {
	constructor(message = "Body exceeds byte limit") {
		super(message);
		this.name = "ByteLimitError";
	}
}

type BodySource = Pick<Response, "headers" | "body">;

/** Read a response (or request) body, aborting as soon as it exceeds `maxBytes`. */
export async function readResponseBytes(
	response: BodySource,
	maxBytes: number,
): Promise<Buffer> {
	if (Number(response.headers.get("content-length")) > maxBytes) {
		await response.body?.cancel();
		throw new ByteLimitError("Download exceeds byte limit");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Empty download");
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			bytes += value.length;
			if (bytes > maxBytes)
				throw new ByteLimitError("Download exceeds byte limit");
			chunks.push(value);
		}
		return Buffer.concat(chunks);
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}

/**
 * Parse a JSON request body of at most `maxBytes`. Throws ByteLimitError when
 * it is larger and SyntaxError when it is not JSON.
 */
export async function readJsonBody(
	request: Request,
	maxBytes: number,
): Promise<unknown> {
	if (!request.body) throw new SyntaxError("Empty body");
	const bytes = await readResponseBytes(request, maxBytes);
	return JSON.parse(bytes.toString("utf8"));
}
