import JSZip from "jszip";

export class ZipLimitError extends Error {
	constructor(message = "ZIP archive exceeds decompression size limit") {
		super(message);
		this.name = "ZipLimitError";
	}
}

export type ExtractedTextFile = { filename: string; content: string };

/**
 * Inflate one entry, stopping as soon as it passes `limit` bytes. Entries are
 * streamed, so a small archive with an extreme compression ratio cannot
 * balloon memory before the size check runs.
 */
function inflateWithin(
	file: JSZip.JSZipObject,
	limit: number,
): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const stream = file.nodeStream("nodebuffer") as NodeJS.ReadableStream & {
			destroy?: () => void;
		};
		const chunks: Buffer[] = [];
		let size = 0;
		let settled = false;
		const fail = (error: Error) => {
			if (settled) return;
			settled = true;
			stream.pause();
			stream.removeAllListeners("data");
			stream.destroy?.();
			reject(error);
		};
		stream.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > limit) fail(new ZipLimitError());
			else chunks.push(chunk);
		});
		stream.on("error", (error: Error) => fail(error));
		stream.on("end", () => {
			if (settled) return;
			settled = true;
			resolve(Buffer.concat(chunks));
		});
	});
}

/**
 * Extract UTF-8 text files from a ZIP archive, optionally below `prefix`
 * (stripped from the returned names). Binary and non-UTF-8 entries are
 * skipped. Throws ZipLimitError when an entry or the total exceeds a limit.
 */
export async function extractTextFiles(
	archive: ArrayBuffer | Uint8Array,
	options: { prefix?: string; maxFileBytes: number; maxTotalBytes: number },
): Promise<ExtractedTextFile[]> {
	const zip = await JSZip.loadAsync(archive);
	const prefix = options.prefix ?? "";
	const files: ExtractedTextFile[] = [];
	let total = 0;

	// Sequential on purpose: peak memory is one entry, not the whole archive.
	for (const [relativePath, file] of Object.entries(zip.files)) {
		if (file.dir) continue;
		if (prefix && !relativePath.startsWith(prefix)) continue;
		const filename = relativePath.slice(prefix.length);
		if (!filename) continue;

		const data = await inflateWithin(
			file,
			Math.min(options.maxFileBytes, options.maxTotalBytes - total),
		);
		total += data.length;

		if (data.includes(0)) continue; // binary
		try {
			files.push({
				filename,
				content: new TextDecoder("utf-8", { fatal: true }).decode(data),
			});
		} catch {
			// Not valid UTF-8; skip.
		}
	}
	return files;
}
