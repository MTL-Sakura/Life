import { checkInAction } from "@/app/actions";

type TaskCardProps = {
  task: {
    id: string;
    title: string;
    categoryLabel: string;
    difficultyLabel: string;
    starterGoal: string;
    standardGoal: string;
    bonusGoal: string | null;
    rewardPreview: string;
    status: string;
    completedTierLabel: string | null;
  };
};

export function TaskCard({ task }: TaskCardProps) {
  return (
    <article className="task-card">
      <div className="task-card-header">
        <div>
          <h2>{task.title}</h2>
          <p>
            {task.categoryLabel} · {task.difficultyLabel}
          </p>
        </div>
        <span className="reward-chip">
          {task.status === "DONE" ? `已完成：${task.completedTierLabel}` : task.rewardPreview}
        </span>
      </div>
      <dl className="goal-list">
        <div>
          <dt>启动</dt>
          <dd>{task.starterGoal}</dd>
        </div>
        <div>
          <dt>完成</dt>
          <dd>{task.standardGoal}</dd>
        </div>
        <div>
          <dt>超额</dt>
          <dd>{task.bonusGoal ?? "完成后再多推进一点"}</dd>
        </div>
      </dl>
      {task.status === "DONE" ? (
        <p className="completed-note">庭院已经收到这束阳光。</p>
      ) : (
        <div className="task-actions">
          <form action={checkInAction}>
            <input name="dailyTaskId" type="hidden" value={task.id} />
            <input name="tier" type="hidden" value="STARTER" />
            <button type="submit">启动</button>
          </form>
          <form action={checkInAction}>
            <input name="dailyTaskId" type="hidden" value={task.id} />
            <input name="tier" type="hidden" value="STANDARD" />
            <button type="submit">完成</button>
          </form>
          <form action={checkInAction}>
            <input name="dailyTaskId" type="hidden" value={task.id} />
            <input name="tier" type="hidden" value="BONUS" />
            <button type="submit">超额</button>
          </form>
        </div>
      )}
    </article>
  );
}
