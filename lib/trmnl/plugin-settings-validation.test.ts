import {
	parseJsonObjectBody,
	readBoundedFormData,
} from "./plugin-settings-validation";

function chunked(body: string, headers: Record<string, string> = {}) {
	// A streamed body has no Content-Length, which used to skip the size check.
	const bytes = new TextEncoder().encode(body);
	return new Request("http://localhost/api/plugin_settings/x/data", {
		method: "POST",
		headers,
		body: new ReadableStream({
			start(controller) {
				for (let i = 0; i < bytes.length; i += 64 * 1024)
					controller.enqueue(bytes.slice(i, i + 64 * 1024));
				controller.close();
			},
		}),
		duplex: "half",
	} as RequestInit);
}

test("parses JSON objects and rejects other shapes", async () => {
	expect(await parseJsonObjectBody(chunked('{"a":1}'))).toEqual({ a: 1 });
	for (const body of ["[1]", "null", "nope"]) {
		const result = await parseJsonObjectBody(chunked(body));
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(422);
	}
});

test("rejects oversized streamed JSON without a Content-Length", async () => {
	const result = await parseJsonObjectBody(
		chunked(JSON.stringify({ x: "y".repeat(2 * 1024 * 1024) })),
	);
	expect(result).toBeInstanceOf(Response);
	expect(await (result as Response).json()).toEqual({
		error: "Request body exceeds 1048576 bytes",
	});
});

test("reads multipart bodies within the limit and rejects larger ones", async () => {
	const form = new FormData();
	form.set("file", "name: Demo");
	const encoded = new Request("http://localhost", {
		method: "POST",
		body: form,
	});
	const contentType = encoded.headers.get("content-type") as string;
	const body = await encoded.text();

	const parsed = await readBoundedFormData(
		chunked(body, { "content-type": contentType }),
		1024,
	);
	expect(parsed).toBeInstanceOf(FormData);
	expect((parsed as FormData).get("file")).toBe("name: Demo");

	const big = new FormData();
	big.set("file", "x".repeat(64 * 1024));
	const bigRequest = new Request("http://localhost", {
		method: "POST",
		body: big,
	});
	const rejected = await readBoundedFormData(
		chunked(await bigRequest.text(), {
			"content-type": bigRequest.headers.get("content-type") as string,
		}),
		1024,
	);
	expect((rejected as Response).status).toBe(422);
});
