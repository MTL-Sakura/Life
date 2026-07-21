"use server";

import type { RepeatRule, TaskCategory, TaskDifficulty } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getTodayRange } from "@/lib/game";
import { prisma } from "@/lib/prisma";

const categories = new Set<TaskCategory>([
  "STUDY",
  "FITNESS",
  "SLEEP",
  "LIFE",
  "CREATION",
  "WORK",
  "CUSTOM",
]);

const difficulties = new Set<TaskDifficulty>(["EASY", "NORMAL", "HARD", "EPIC"]);
const repeatRules = new Set<RepeatRule>(["NONE", "DAILY", "WEEKLY"]);

export async function createTaskAction(formData: FormData) {
  const session = await requireSession();
  const title = String(formData.get("title") ?? "").trim();
  const category = parseCategory(formData.get("category"));
  const difficulty = parseDifficulty(formData.get("difficulty"));
  const repeatRule = parseRepeatRule(formData.get("repeatRule"));
  const starterGoal = String(formData.get("starterGoal") ?? "").trim();
  const standardGoal = String(formData.get("standardGoal") ?? "").trim();
  const bonusGoal = String(formData.get("bonusGoal") ?? "").trim();
  const addToToday = formData.get("addToToday") === "on";

  if (!title || !starterGoal || !standardGoal) {
    redirect("/tasks/new?error=missing");
  }

  const task = await prisma.taskTemplate.create({
    data: {
      userId: session.userId,
      title,
      category,
      difficulty,
      repeatRule,
      starterGoal,
      standardGoal,
      bonusGoal: bonusGoal || null,
    },
  });

  if (addToToday) {
    await addTemplateToToday(session.userId, task.id);
  }

  revalidatePath("/");
  revalidatePath("/tasks");
  redirect("/tasks");
}

export async function updateTaskAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const category = parseCategory(formData.get("category"));
  const difficulty = parseDifficulty(formData.get("difficulty"));
  const repeatRule = parseRepeatRule(formData.get("repeatRule"));
  const starterGoal = String(formData.get("starterGoal") ?? "").trim();
  const standardGoal = String(formData.get("standardGoal") ?? "").trim();
  const bonusGoal = String(formData.get("bonusGoal") ?? "").trim();

  if (!id || !title || !starterGoal || !standardGoal) {
    redirect("/tasks");
  }

  await prisma.taskTemplate.updateMany({
    where: {
      id,
      userId: session.userId,
    },
    data: {
      title,
      category,
      difficulty,
      repeatRule,
      starterGoal,
      standardGoal,
      bonusGoal: bonusGoal || null,
    },
  });

  revalidatePath("/");
  revalidatePath("/tasks");
  redirect("/tasks");
}

export async function pauseTaskAction(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("id") ?? "");

  if (!id) {
    return;
  }

  await prisma.taskTemplate.updateMany({
    where: {
      id,
      userId: session.userId,
    },
    data: {
      isActive: false,
    },
  });

  revalidatePath("/tasks");
}

export async function addTemplateToTodayAction(formData: FormData) {
  const session = await requireSession();
  const templateId = String(formData.get("templateId") ?? "");

  if (!templateId) {
    return;
  }

  await addTemplateToToday(session.userId, templateId);
  revalidatePath("/");
  revalidatePath("/tasks");
}

async function addTemplateToToday(userId: string, templateId: string) {
  const { start, end } = getTodayRange();
  const template = await prisma.taskTemplate.findFirst({
    where: {
      id: templateId,
      userId,
      isActive: true,
    },
  });

  if (!template) {
    return;
  }

  const exists = await prisma.dailyTask.findFirst({
    where: {
      userId,
      templateId,
      date: {
        gte: start,
        lt: end,
      },
    },
    select: { id: true },
  });

  if (exists) {
    return;
  }

  await prisma.dailyTask.create({
    data: {
      userId,
      templateId,
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

function parseCategory(value: FormDataEntryValue | null): TaskCategory {
  const category = String(value ?? "CUSTOM") as TaskCategory;
  return categories.has(category) ? category : "CUSTOM";
}

function parseDifficulty(value: FormDataEntryValue | null): TaskDifficulty {
  const difficulty = String(value ?? "NORMAL") as TaskDifficulty;
  return difficulties.has(difficulty) ? difficulty : "NORMAL";
}

function parseRepeatRule(value: FormDataEntryValue | null): RepeatRule {
  const repeatRule = String(value ?? "NONE") as RepeatRule;
  return repeatRules.has(repeatRule) ? repeatRule : "NONE";
}
