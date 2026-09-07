export async function readResponseBytes(
	response: Response,
	maxBytes: number,
): Promise<Buffer> {
	if (Number(response.headers.get("content-length")) > maxBytes) {
		await response.body?.cancel();
		throw new Error("Download exceeds byte limit");
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
			if (bytes > maxBytes) throw new Error("Download exceeds byte limit");
			chunks.push(value);
		}
		return Buffer.concat(chunks);
	} finally {
		await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
}
