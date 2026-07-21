import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const username = process.env.APP_OWNER_USERNAME ?? "sakura";
  const initialPassword = process.env.APP_OWNER_INITIAL_PASSWORD;

  let user = await prisma.user.findUnique({
    where: { username },
  });

  if (!user) {
    if (!initialPassword || initialPassword === "change-this-password") {
      throw new Error("Set APP_OWNER_INITIAL_PASSWORD before first seed.");
    }

    const passwordHash = await bcrypt.hash(initialPassword, 12);

    user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        profile: {
          create: {
            displayName: "Sakura",
            sunlight: 24,
            water: 12,
            coins: 36,
          },
        },
        gardenState: {
          create: {
            treeStage: 2,
            treeXp: 45,
            unlockedDecorations: ["bench"],
            placedDecorations: { leftFront: "bench" },
          },
        },
      },
    });
  } else {
    await prisma.profile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        displayName: "Sakura",
      },
    });

    await prisma.gardenState.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        unlockedDecorations: [],
        placedDecorations: {},
      },
    });
  }

  const taskCount = await prisma.taskTemplate.count({
    where: { userId: user.id },
  });

  if (taskCount === 0) {
    await prisma.taskTemplate.createMany({
      data: [
        {
          userId: user.id,
          title: "学习 30 分钟",
          category: "STUDY",
          difficulty: "NORMAL",
          starterGoal: "打开书或课程，坚持 5 分钟",
          standardGoal: "专注学习 30 分钟",
          bonusGoal: "专注学习 90 分钟",
          repeatRule: "DAILY",
        },
        {
          userId: user.id,
          title: "健身 20 分钟",
          category: "FITNESS",
          difficulty: "NORMAL",
          starterGoal: "完成 1 组动作",
          standardGoal: "训练 20 分钟",
          bonusGoal: "训练 45 分钟",
          repeatRule: "DAILY",
        },
        {
          userId: user.id,
          title: "整理生活区",
          category: "LIFE",
          difficulty: "EASY",
          starterGoal: "整理桌面 3 分钟",
          standardGoal: "整理房间 10 分钟",
          bonusGoal: "完成一次深度整理",
          repeatRule: "WEEKLY",
        },
      ],
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
