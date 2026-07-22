import type { TaskCategory } from "@prisma/client";

export type GardenSignal =
  | "study"
  | "fitness"
  | "sleep"
  | "life"
  | "creation"
  | "work"
  | "streak";

export const gardenSignalByCategory: Record<TaskCategory, GardenSignal> = {
  STUDY: "study",
  FITNESS: "fitness",
  SLEEP: "sleep",
  LIFE: "life",
  CREATION: "creation",
  WORK: "work",
  CUSTOM: "creation",
};

const signalOrder: GardenSignal[] = [
  "streak",
  "study",
  "fitness",
  "life",
  "creation",
  "work",
  "sleep",
];

export const gardenSignalDetails: Record<GardenSignal, { title: string; text: string }> = {
  study: {
    title: "书页被打开",
    text: "完成学习后，树下会自动多出书本和安静的光。",
  },
  fitness: {
    title: "小路更有精神",
    text: "完成健身后，庭院角落会留下训练后的活力。",
  },
  sleep: {
    title: "灯光变柔和",
    text: "照顾睡眠后，庭院会变得更安静、更适合恢复。",
  },
  life: {
    title: "花圃被照顾",
    text: "完成生活整理后，浇水壶会出现在花圃旁。",
  },
  creation: {
    title: "灵感停在树下",
    text: "完成创作后，画架会自动摆到樱花树旁。",
  },
  work: {
    title: "计划板亮起来",
    text: "完成工作后，庭院会多一块清爽的计划板。",
  },
  streak: {
    title: "连续照顾中",
    text: "连续打卡会让庭院挂上小旗，提醒你已经在前进。",
  },
};

export function getGardenSignals(categories: TaskCategory[], currentStreak = 0) {
  const signals = new Set(categories.map((category) => gardenSignalByCategory[category]));

  if (currentStreak >= 3) {
    signals.add("streak");
  }

  return signalOrder.filter((signal) => signals.has(signal));
}

export function getGardenEcho(category: TaskCategory) {
  const signal = gardenSignalByCategory[category];

  return gardenSignalDetails[signal].text;
}
