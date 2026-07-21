"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function changePasswordAction(formData: FormData) {
  const session = await requireSession();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const nextPassword = String(formData.get("nextPassword") ?? "");

  if (!currentPassword || nextPassword.length < 8) {
    redirect("/me?password=invalid");
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.userId },
    select: { passwordHash: true },
  });

  const isValid = await bcrypt.compare(currentPassword, user.passwordHash);

  if (!isValid) {
    redirect("/me?password=wrong");
  }

  const passwordHash = await bcrypt.hash(nextPassword, 12);

  await prisma.user.update({
    where: { id: session.userId },
    data: { passwordHash },
  });

  revalidatePath("/me");
  redirect("/me?password=updated");
}
