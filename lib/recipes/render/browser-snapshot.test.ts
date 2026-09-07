import { storeBrowserSnapshot, takeBrowserSnapshot } from "./browser-snapshot";

test("snapshots are one-use and scoped to the signed tenant and recipe", () => {
	const value = { params: { city: "London" }, data: { temperature: 20 } };
	const id = storeBrowserSnapshot(value, "alice", "weather");
	expect(takeBrowserSnapshot(id, "bob", "weather")).toBeNull();
	expect(takeBrowserSnapshot(id, "alice", "calendar")).toBeNull();
	expect(takeBrowserSnapshot(id, "alice", "weather")).toEqual(value);
	expect(takeBrowserSnapshot(id, "alice", "weather")).toBeNull();
});
