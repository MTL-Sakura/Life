"use server";

import { redirect } from "next/navigation";
import { createSession, verifyOwnerPassword } from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    redirect("/login?error=missing");
  }

  const owner = await verifyOwnerPassword(username, password);

  if (!owner) {
    redirect("/login?error=invalid");
  }

  await createSession({
    userId: owner.id,
    username: owner.username,
  });

  redirect("/");
}
