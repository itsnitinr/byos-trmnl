import { isPublicAddress, resolvePublicUrl } from "./public-fetch";

test("rejects loopback, private, mapped and special-use addresses", async () => {
	for (const ip of [
		"127.0.0.1",
		"10.2.3.4",
		"169.254.169.254",
		"172.16.0.1",
		"192.168.1.1",
		"100.64.0.1",
		"::1",
		"::ffff:127.0.0.1",
		"fc00::1",
		"fe80::1",
		"2001:db8::1",
	])
		expect(isPublicAddress(ip)).toBe(false);
	for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])
		expect(isPublicAddress(ip)).toBe(true);
	for (const url of [
		"file:///etc/passwd",
		"http://user:secret@example.com",
		"http://127.1",
		"http://[::1]",
	])
		await expect(resolvePublicUrl(url)).rejects.toThrow();
});
