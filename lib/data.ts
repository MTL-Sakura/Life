import type { CompletionTier, DailyTask } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  categoryLabels,
  calculateReward,
  difficultyLabels,
  formatDateKey,
  getLevelProgress,
  getMonthRange,
  getTodayRange,
  getTreeStageFromXp,
  tierLabels,
} from "@/lib/game";

export async function ensureTodayTasks(userId: string) {
  const { start, end } = getTodayRange();

  const dailyTemplates = await prisma.taskTemplate.findMany({
    where: {
      userId,
      isActive: true,
      repeatRule: "DAILY",
    },
  });

  for (const template of dailyTemplates) {
    const exists = await prisma.dailyTask.findFirst({
      where: {
        userId,
        templateId: template.id,
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
          userId,
          templateId: template.id,
          date: start,
          title: template.title,
          category: template.category,
          difficulty: template.difficulty,
          starterGoal: template.starterGoal,
          standardGoal: template.standardGoal,
          bonusGoal: template.bonusGoal,
        },
      });
    }
  }
}

export async function getDashboardData(userId: string) {
  await ensureTodayTasks(userId);

  const { start, end } = getTodayRange();

  const [profile, gardenState, dailyTasks, checkInsToday] = await Promise.all([
    prisma.profile.findUniqueOrThrow({ where: { userId } }),
    prisma.gardenState.findUniqueOrThrow({ where: { userId } }),
    prisma.dailyTask.findMany({
      where: {
        userId,
        date: {
          gte: start,
          lt: end,
        },
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    }),
    prisma.checkIn.findMany({
      where: {
        userId,
        date: {
          gte: start,
          lt: end,
        },
      },
    }),
  ]);

  const doneCount = dailyTasks.filter((task) => task.status === "DONE").length;
  const levelProgress = getLevelProgress(profile.xp);

  return {
    profile,
    gardenState: {
      ...gardenState,
      treeStage: getTreeStageFromXp(gardenState.treeXp),
    },
    levelProgress,
    dailyTasks: dailyTasks.map(toDailyTaskView),
    doneCount,
    totalCount: dailyTasks.length,
    todayReward: checkInsToday.reduce(
      (sum, checkIn) => ({
        xp: sum.xp + checkIn.xpGained,
        sunlight: sum.sunlight + checkIn.sunlightGained,
        water: sum.water + checkIn.waterGained,
        coins: sum.coins + checkIn.coinsGained,
      }),
      { xp: 0, sunlight: 0, water: 0, coins: 0 },
    ),
  };
}

export async function getTaskLibrary(userId: string) {
  const tasks = await prisma.taskTemplate.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });

  return tasks.map((task) => ({
    ...task,
    categoryLabel: categoryLabels[task.category],
    difficultyLabel: difficultyLabels[task.difficulty],
    repeatLabel:
      task.repeatRule === "DAILY"
        ? "每天"
        : task.repeatRule === "WEEKLY"
          ? "每周"
          : "不重复",
  }));
}

export async function getTaskTemplateForEdit(userId: string, id: string) {
  return prisma.taskTemplate.findFirst({
    where: {
      id,
      userId,
    },
  });
}

export async function getGardenData(userId: string) {
  const [profile, gardenState] = await Promise.all([
    prisma.profile.findUniqueOrThrow({ where: { userId } }),
    prisma.gardenState.findUniqueOrThrow({ where: { userId } }),
  ]);

  const treeStage = getTreeStageFromXp(gardenState.treeXp);
  const nextStageXp = treeStage >= 6 ? gardenState.treeXp : treeStage * 120;
  const remainingSunlight = Math.max(0, nextStageXp - gardenState.treeXp);

  return {
    profile,
    gardenState: {
      ...gardenState,
      treeStage,
      remainingSunlight,
      progressPercent: treeStage >= 6 ? 100 : Math.round((gardenState.treeXp / nextStageXp) * 100),
    },
  };
}

export async function getCalendarData(userId: string) {
  const { start, end } = getMonthRange();
  const checkIns = await prisma.checkIn.findMany({
    where: {
      userId,
      date: {
        gte: start,
        lt: end,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const grouped = new Map<string, typeof checkIns>();

  for (const checkIn of checkIns) {
    const key = formatDateKey(checkIn.date);
    grouped.set(key, [...(grouped.get(key) ?? []), checkIn]);
  }

  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), index + 1);
    const key = formatDateKey(date);
    const records = grouped.get(key) ?? [];

    return {
      day: index + 1,
      date,
      key,
      intensity: Math.min(4, records.length),
      xp: records.reduce((sum, record) => sum + record.xpGained, 0),
      count: records.length,
    };
  });

  const latest = checkIns.at(-1);

  return {
    monthLabel: `${start.getFullYear()} 年 ${start.getMonth() + 1} 月`,
    days,
    latestSummary: latest
      ? {
          date: latest.date,
          tier: tierLabels[latest.tier],
          xp: latest.xpGained,
          attribute: latest.attributeGained,
        }
      : null,
  };
}

export async function getProfileData(userId: string) {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { userId },
  });
  const achievements = await prisma.achievement.findMany({
    where: {
      userId,
      unlockedAt: {
        not: null,
      },
    },
    orderBy: { unlockedAt: "desc" },
    take: 6,
  });

  return {
    profile,
    levelProgress: getLevelProgress(profile.xp),
    achievements,
  };
}

function toDailyTaskView(task: DailyTask) {
  return {
    ...task,
    categoryLabel: categoryLabels[task.category],
    difficultyLabel: difficultyLabels[task.difficulty],
    rewardPreview: formatRewardPreview(task),
    completedTierLabel: task.completedTier
      ? tierLabels[task.completedTier as CompletionTier]
      : null,
  };
}

function formatRewardPreview(task: DailyTask) {
  const reward = calculateReward({
    category: task.category,
    difficulty: task.difficulty,
    tier: "STANDARD",
  });

  return `+${reward.xpGained} XP +${reward.sunlightGained} 阳光`;
}
