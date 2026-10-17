import { redirect } from "next/navigation";
import { connection } from "next/server";
import type React from "react";
import { auth } from "@/lib/auth/auth";
import { getCurrentUser } from "@/lib/auth/get-user";

export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	// If auth is disabled, redirect away from admin pages
	if (!auth) {
		redirect("/");
	}

	await connection();

	const user = await getCurrentUser();
	if (user?.role !== "admin") {
		redirect("/");
	}

	return <>{children}</>;
}
