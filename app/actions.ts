"use server";

import type { CompletionTier, TaskCategory } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearSession, requireSession } from "@/lib/auth";
import {
  calculateReward,
  getLevelFromXp,
  getTodayRange,
  getTreeStageFromXp,
  getYesterdayRange,
} from "@/lib/game";
import { prisma } from "@/lib/prisma";

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}

export async function checkInAction(formData: FormData) {
  const session = await requireSession();
  const dailyTaskId = String(formData.get("dailyTaskId") ?? "");
  const tier = String(formData.get("tier") ?? "") as CompletionTier;

  if (!dailyTaskId || !["STARTER", "STANDARD", "BONUS"].includes(tier)) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const dailyTask = await tx.dailyTask.findFirst({
      where: {
        id: dailyTaskId,
        userId: session.userId,
      },
    });

    if (!dailyTask || dailyTask.status === "DONE") {
      return;
    }

    const reward = calculateReward({
      category: dailyTask.category,
      difficulty: dailyTask.difficulty,
      tier,
    });

    const profile = await tx.profile.findUniqueOrThrow({
      where: { userId: session.userId },
    });

    const gardenState = await tx.gardenState.findUniqueOrThrow({
      where: { userId: session.userId },
    });

    const nextXp = profile.xp + reward.xpGained;
    const nextTreeXp = gardenState.treeXp + reward.sunlightGained;
    const today = getTodayRange();
    const yesterday = getYesterdayRange();
    const [hasCheckInToday, hadCheckInYesterday] = await Promise.all([
      tx.checkIn.findFirst({
        where: {
          userId: session.userId,
          date: {
            gte: today.start,
            lt: today.end,
          },
        },
        select: { id: true },
      }),
      tx.checkIn.findFirst({
        where: {
          userId: session.userId,
          date: {
            gte: yesterday.start,
            lt: yesterday.end,
          },
        },
        select: { id: true },
      }),
    ]);
    const nextCurrentStreak = hasCheckInToday
      ? profile.currentStreak
      : hadCheckInYesterday
        ? profile.currentStreak + 1
        : 1;
    const attributeUpdate = getAttributeUpdate(
      dailyTask.category,
      reward.attributePoints,
    );

    await tx.dailyTask.update({
      where: { id: dailyTask.id },
      data: {
        status: "DONE",
        completedTier: tier,
        completedAt: new Date(),
      },
    });

    await tx.checkIn.create({
      data: {
        userId: session.userId,
        dailyTaskId: dailyTask.id,
        date: new Date(),
        tier,
        xpGained: reward.xpGained,
        sunlightGained: reward.sunlightGained,
        waterGained: reward.waterGained,
        coinsGained: reward.coinsGained,
        petalsGained: reward.petalsGained,
        attributeGained: `${reward.attributeLabel} +${reward.attributePoints}`,
      },
    });

    await tx.profile.update({
      where: { userId: session.userId },
      data: {
        xp: nextXp,
        level: getLevelFromXp(nextXp),
        sunlight: { increment: reward.sunlightGained },
        water: { increment: reward.waterGained },
        coins: { increment: reward.coinsGained },
        petals: { increment: reward.petalsGained },
        currentStreak: nextCurrentStreak,
        longestStreak: Math.max(profile.longestStreak, nextCurrentStreak),
        ...attributeUpdate,
      },
    });

    await tx.gardenState.update({
      where: { userId: session.userId },
      data: {
        treeXp: nextTreeXp,
        treeStage: getTreeStageFromXp(nextTreeXp),
        gardenLevel: Math.max(gardenState.gardenLevel, getTreeStageFromXp(nextTreeXp)),
      },
    });
  });

  revalidatePath("/");
  revalidatePath("/garden");
  revalidatePath("/calendar");
  revalidatePath("/me");
}

export async function createLowEnergyTaskAction() {
  const session = await requireSession();
  const { start, end } = getTodayRange();

  const exists = await prisma.dailyTask.findFirst({
    where: {
      userId: session.userId,
      title: "低能量照顾庭院",
      date: {
        gte: start,
        lt: end,
      },
    },
    select: { id: true },
  });

  if (!exists) {
    await prisma.dailyTask.create({
      data: {
        userId: session.userId,
        date: start,
        title: "低能量照顾庭院",
        category: "LIFE",
        difficulty: "EASY",
        starterGoal: "打开应用，完成一个 3 分钟的小行动",
        standardGoal: "照顾自己和庭院 10 分钟",
        bonusGoal: "再完成一个轻量任务",
      },
    });
  }

  revalidatePath("/");
}

function getAttributeUpdate(
  category: TaskCategory,
  points: number,
): Record<string, { increment: number }> {
  const keyByCategory: Record<TaskCategory, string> = {
    STUDY: "focus",
    FITNESS: "fitness",
    SLEEP: "recovery",
    LIFE: "order",
    CREATION: "creativity",
    WORK: "focus",
    CUSTOM: "creativity",
  };

  return {
    [keyByCategory[category]]: {
      increment: points,
    },
  };
}
