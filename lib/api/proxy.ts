/**
 * Utility functions for proxying requests to TRMNL API
 */

const TRMNL_API_BASE = "https://usetrmnl.com";
const PROXY_TIMEOUT_MS = 15_000;

export interface ProxyOptions {
	/**
	 * Whether to forward the Authorization header
	 */
	forwardAuth?: boolean;
	/**
	 * Additional headers to include
	 */
	headers?: Record<string, string>;
	/**
	 * Request body (for POST/PATCH requests)
	 */
	body?: unknown;
}

/**
 * Proxy a request to the TRMNL API
 */
export async function proxyToTRMNL(
	path: string,
	method: string = "GET",
	request: Request,
	options: ProxyOptions = {},
): Promise<Response> {
	// Preserve query parameters from the original request
	const requestUrl = new URL(request.url);
	const queryString = requestUrl.search;
	const url = `${TRMNL_API_BASE}${path}${queryString}`;

	const headers: HeadersInit = {
		"Content-Type": "application/json",
		...options.headers,
	};

	// Forward Authorization header if present and requested
	if (options.forwardAuth) {
		const authHeader = request.headers.get("Authorization");
		if (authHeader) {
			headers.Authorization = authHeader;
		}
	}

	// Forward other relevant headers
	const accessToken = request.headers.get("Access-Token");
	if (accessToken) {
		headers["Access-Token"] = accessToken;
	}

	const fetchOptions: RequestInit = {
		method,
		headers,
		signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
	};

	// Add body for POST/PATCH/PUT requests
	if (
		options.body &&
		(method === "POST" || method === "PATCH" || method === "PUT")
	) {
		fetchOptions.body = JSON.stringify(options.body);
	}

	try {
		const response = await fetch(url, fetchOptions);
		// Pass the upstream body through; error pages are often HTML, not JSON.
		return new Response(await response.text(), {
			status: response.status,
			headers: {
				"Content-Type":
					response.headers.get("content-type") ?? "application/json",
			},
		});
	} catch (error) {
		return new Response(
			JSON.stringify({
				error: "Failed to proxy request to TRMNL API",
				message: error instanceof Error ? error.message : "Unknown error",
			}),
			{
				status: 502,
				headers: {
					"Content-Type": "application/json",
				},
			},
		);
	}
}
