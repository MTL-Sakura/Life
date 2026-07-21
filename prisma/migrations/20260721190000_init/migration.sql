-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Profile` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `sunlight` INTEGER NOT NULL DEFAULT 0,
    `water` INTEGER NOT NULL DEFAULT 0,
    `coins` INTEGER NOT NULL DEFAULT 0,
    `petals` INTEGER NOT NULL DEFAULT 0,
    `focus` INTEGER NOT NULL DEFAULT 0,
    `fitness` INTEGER NOT NULL DEFAULT 0,
    `order` INTEGER NOT NULL DEFAULT 0,
    `creativity` INTEGER NOT NULL DEFAULT 0,
    `recovery` INTEGER NOT NULL DEFAULT 0,
    `currentStreak` INTEGER NOT NULL DEFAULT 0,
    `longestStreak` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Profile_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `category` ENUM('STUDY', 'FITNESS', 'SLEEP', 'LIFE', 'CREATION', 'WORK', 'CUSTOM') NOT NULL,
    `difficulty` ENUM('EASY', 'NORMAL', 'HARD', 'EPIC') NOT NULL DEFAULT 'NORMAL',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `starterGoal` VARCHAR(191) NOT NULL,
    `standardGoal` VARCHAR(191) NOT NULL,
    `bonusGoal` VARCHAR(191) NULL,
    `repeatRule` ENUM('NONE', 'DAILY', 'WEEKLY') NOT NULL DEFAULT 'NONE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TaskTemplate_userId_category_idx`(`userId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyTask` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `category` ENUM('STUDY', 'FITNESS', 'SLEEP', 'LIFE', 'CREATION', 'WORK', 'CUSTOM') NOT NULL,
    `difficulty` ENUM('EASY', 'NORMAL', 'HARD', 'EPIC') NOT NULL DEFAULT 'NORMAL',
    `starterGoal` VARCHAR(191) NOT NULL,
    `standardGoal` VARCHAR(191) NOT NULL,
    `bonusGoal` VARCHAR(191) NULL,
    `status` ENUM('TODO', 'DONE', 'SKIPPED') NOT NULL DEFAULT 'TODO',
    `completedTier` ENUM('STARTER', 'STANDARD', 'BONUS') NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DailyTask_userId_date_idx`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CheckIn` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `dailyTaskId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `tier` ENUM('STARTER', 'STANDARD', 'BONUS') NOT NULL,
    `xpGained` INTEGER NOT NULL,
    `sunlightGained` INTEGER NOT NULL,
    `waterGained` INTEGER NOT NULL,
    `coinsGained` INTEGER NOT NULL,
    `petalsGained` INTEGER NOT NULL DEFAULT 0,
    `attributeGained` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CheckIn_userId_date_idx`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GardenState` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `treeStage` INTEGER NOT NULL DEFAULT 1,
    `treeXp` INTEGER NOT NULL DEFAULT 0,
    `gardenLevel` INTEGER NOT NULL DEFAULT 1,
    `unlockedDecorations` JSON NOT NULL,
    `placedDecorations` JSON NOT NULL,
    `theme` VARCHAR(191) NOT NULL DEFAULT 'spring',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GardenState_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Achievement` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NOT NULL,
    `unlockedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Achievement_userId_key_key`(`userId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Profile` ADD CONSTRAINT `Profile_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskTemplate` ADD CONSTRAINT `TaskTemplate_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyTask` ADD CONSTRAINT `DailyTask_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyTask` ADD CONSTRAINT `DailyTask_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `TaskTemplate`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CheckIn` ADD CONSTRAINT `CheckIn_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CheckIn` ADD CONSTRAINT `CheckIn_dailyTaskId_fkey` FOREIGN KEY (`dailyTaskId`) REFERENCES `DailyTask`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GardenState` ADD CONSTRAINT `GardenState_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Achievement` ADD CONSTRAINT `Achievement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
