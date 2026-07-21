import type {
  CompletionTier,
  TaskCategory,
  TaskDifficulty,
} from "@prisma/client";

export const categoryLabels: Record<TaskCategory, string> = {
  STUDY: "学习",
  FITNESS: "健身",
  SLEEP: "睡眠",
  LIFE: "生活",
  CREATION: "创作",
  WORK: "工作",
  CUSTOM: "自定义",
};

export const difficultyLabels: Record<TaskDifficulty, string> = {
  EASY: "简单",
  NORMAL: "普通",
  HARD: "困难",
  EPIC: "史诗",
};

export const tierLabels: Record<CompletionTier, string> = {
  STARTER: "启动",
  STANDARD: "完成",
  BONUS: "超额",
};

const difficultyMultiplier: Record<TaskDifficulty, number> = {
  EASY: 1,
  NORMAL: 1.3,
  HARD: 1.8,
  EPIC: 2.5,
};

const tierMultiplier: Record<CompletionTier, number> = {
  STARTER: 0.3,
  STANDARD: 1,
  BONUS: 1.5,
};

const categoryAttribute: Record<TaskCategory, string> = {
  STUDY: "focus",
  FITNESS: "fitness",
  SLEEP: "recovery",
  LIFE: "order",
  CREATION: "creativity",
  WORK: "focus",
  CUSTOM: "creativity",
};

const categoryAttributeLabel: Record<TaskCategory, string> = {
  STUDY: "专注",
  FITNESS: "体能",
  SLEEP: "恢复",
  LIFE: "秩序",
  CREATION: "创造",
  WORK: "专注",
  CUSTOM: "创造",
};

export function getTodayRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
}

export function getYesterdayRange(now = new Date()) {
  const today = getTodayRange(now);
  const start = new Date(today.start);
  start.setDate(start.getDate() - 1);

  return {
    start,
    end: today.start,
  };
}

export function getMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  return { start, end };
}

export function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function getLevelFromXp(xp: number) {
  return Math.floor(xp / 180) + 1;
}

export function getLevelProgress(xp: number) {
  return {
    current: xp % 180,
    next: 180,
    percent: Math.min(100, Math.round(((xp % 180) / 180) * 100)),
  };
}

export function getTreeStageFromXp(treeXp: number) {
  return Math.min(6, Math.floor(treeXp / 120) + 1);
}

export function calculateReward({
  category,
  difficulty,
  tier,
}: {
  category: TaskCategory;
  difficulty: TaskDifficulty;
  tier: CompletionTier;
}) {
  const multiplier = difficultyMultiplier[difficulty] * tierMultiplier[tier];
  const xpGained = Math.max(1, Math.round(32 * multiplier));
  const sunlightGained = Math.max(1, Math.round(7 * multiplier));
  const waterGained = tier === "STARTER" ? 1 : Math.max(1, Math.round(4 * multiplier));
  const coinsGained = Math.max(1, Math.round(5 * multiplier));
  const petalsGained = tier === "BONUS" && difficulty !== "EASY" ? 1 : 0;
  const attributePoints = Math.max(1, Math.round(2 * multiplier));

  return {
    xpGained,
    sunlightGained,
    waterGained,
    coinsGained,
    petalsGained,
    attributeKey: categoryAttribute[category],
    attributeLabel: categoryAttributeLabel[category],
    attributePoints,
  };
}
