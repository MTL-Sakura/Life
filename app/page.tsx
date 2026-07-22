import Link from "next/link";
import { createLowEnergyTaskAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { GardenScene } from "@/components/garden-scene";
import { TaskCard } from "@/components/task-card";
import { requireSession } from "@/lib/auth";
import { getDashboardData } from "@/lib/data";

export default async function HomePage() {
  const session = await requireSession();
  const dashboard = await getDashboardData(session.userId);

  return (
    <AppShell active="today">
      <section className="today-grid">
        <div className="garden-column">
          <GardenScene
            mood="morning"
            signals={dashboard.gardenSignals}
            stage={dashboard.gardenState.treeStage}
            streak={dashboard.profile.currentStreak}
          />
          {dashboard.gardenFeedback ? (
            <section className="garden-feedback" aria-label="庭院回应">
              <p className="eyebrow">庭院回应</p>
              <h2>{dashboard.gardenFeedback.title}</h2>
              <p>{dashboard.gardenFeedback.message}</p>
              <span>{dashboard.gardenFeedback.reward}</span>
            </section>
          ) : null}
          <section className="settlement-strip" aria-label="今日进度">
            <div>
              <span className="metric-value">
                {dashboard.doneCount} / {dashboard.totalCount}
              </span>
              <span className="metric-label">今日完成</span>
            </div>
            <div>
              <span className="metric-value">{dashboard.profile.currentStreak} 天</span>
              <span className="metric-label">连续照顾</span>
            </div>
            <div>
              <span className="metric-value">Lv. {dashboard.gardenState.gardenLevel}</span>
              <span className="metric-label">庭院等级</span>
            </div>
          </section>
        </div>

        <section className="task-column" aria-labelledby="today-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">今日</p>
              <h1 id="today-title">
                {dashboard.doneCount > 0 ? "庭院收到了新的阳光" : "庭院等待第一束阳光"}
              </h1>
            </div>
            <form action={createLowEnergyTaskAction}>
              <button className="quiet-action" type="submit">
                低能量
              </button>
            </form>
          </div>

          <div className="resource-row" aria-label="资源">
            <span>
              XP {dashboard.levelProgress.current} / {dashboard.levelProgress.next}
            </span>
            <span>阳光 {dashboard.profile.sunlight}</span>
            <span>水滴 {dashboard.profile.water}</span>
            <span>樱花币 {dashboard.profile.coins}</span>
          </div>

          <div className="task-list">
            {dashboard.dailyTasks.length > 0 ? (
              dashboard.dailyTasks.map((task) => <TaskCard key={task.id} task={task} />)
            ) : (
              <article className="empty-panel">
                <h2>庭院还在等待今天的第一束阳光</h2>
                <p>先从一个 5 分钟能开始的小任务出发。</p>
                <Link className="primary-action link-action" href="/tasks/new">
                  添加第一个任务
                </Link>
              </article>
            )}
          </div>

          <div className="today-actions">
            <Link className="primary-action link-action" href="/tasks">
              添加今日任务
            </Link>
            <span className="secondary-action summary-chip">
              今日 +{dashboard.todayReward.xp} XP
            </span>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
