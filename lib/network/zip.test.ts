import JSZip from "jszip";
import { extractTextFiles, ZipLimitError } from "./zip";

async function archive(files: Record<string, string | Uint8Array>) {
	const zip = new JSZip();
	for (const [name, content] of Object.entries(files)) zip.file(name, content);
	return zip.generateAsync({
		type: "uint8array",
		compression: "DEFLATE",
		compressionOptions: { level: 9 },
	});
}

const limits = { maxFileBytes: 64 * 1024, maxTotalBytes: 128 * 1024 };

test("extracts text files below a prefix and skips binaries", async () => {
	const zip = await archive({
		"repo-main/src/full.liquid": "<h1>{{ title }}</h1>",
		"repo-main/src/settings.yml": "name: Demo",
		"repo-main/src/logo.png": new Uint8Array([137, 80, 78, 71, 0, 1]),
		"other/ignored.liquid": "x",
	});
	const files = await extractTextFiles(zip, {
		...limits,
		prefix: "repo-main/src/",
	});
	expect(files.sort((a, b) => a.filename.localeCompare(b.filename))).toEqual([
		{ filename: "full.liquid", content: "<h1>{{ title }}</h1>" },
		{ filename: "settings.yml", content: "name: Demo" },
	]);
});

test("stops inflating an entry that exceeds the per-file limit", async () => {
	// ~10 MB of zeros compresses to a few KB: a miniature zip bomb.
	const zip = await archive({ "bomb.txt": "a".repeat(10 * 1024 * 1024) });
	expect(zip.length).toBeLessThan(64 * 1024);
	await expect(extractTextFiles(zip, limits)).rejects.toBeInstanceOf(
		ZipLimitError,
	);
});

test("enforces the total decompressed limit across entries", async () => {
	const zip = await archive({
		"a.txt": "a".repeat(60 * 1024),
		"b.txt": "b".repeat(60 * 1024),
		"c.txt": "c".repeat(60 * 1024),
	});
	await expect(extractTextFiles(zip, limits)).rejects.toBeInstanceOf(
		ZipLimitError,
	);
});
