import { notFound } from "next/navigation";
import { pauseTaskAction, updateTaskAction } from "@/app/tasks/actions";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { getTaskTemplateForEdit } from "@/lib/data";

const categories = [
  ["STUDY", "学习"],
  ["FITNESS", "健身"],
  ["SLEEP", "睡眠"],
  ["LIFE", "生活"],
  ["CREATION", "创作"],
  ["WORK", "工作"],
  ["CUSTOM", "自定义"],
];
const difficulties = [
  ["EASY", "简单"],
  ["NORMAL", "普通"],
  ["HARD", "困难"],
  ["EPIC", "史诗"],
];

type EditTaskPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditTaskPage({ params }: EditTaskPageProps) {
  const session = await requireSession();
  const { id } = await params;
  const task = await getTaskTemplateForEdit(session.userId, id);

  if (!task) {
    notFound();
  }

  return (
    <AppShell active="tasks">
      <PageHeader eyebrow="编辑任务" title="调整任务到刚好能开始" />

      <form action={updateTaskAction} className="task-form">
        <input name="id" type="hidden" value={task.id} />
        <label>
          任务名称
          <input defaultValue={task.title} name="title" required type="text" />
        </label>

        <div className="form-grid">
          <label>
            分类
            <select defaultValue={task.category} name="category">
              {categories.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            难度
            <select defaultValue={task.difficulty} name="difficulty">
              {difficulties.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          重复
          <select defaultValue={task.repeatRule} name="repeatRule">
            <option value="NONE">不重复</option>
            <option value="DAILY">每天</option>
            <option value="WEEKLY">每周</option>
          </select>
        </label>
        <label>
          启动版
          <input defaultValue={task.starterGoal} name="starterGoal" required type="text" />
        </label>
        <label>
          标准版
          <input defaultValue={task.standardGoal} name="standardGoal" required type="text" />
        </label>
        <label>
          超额版
          <input defaultValue={task.bonusGoal ?? ""} name="bonusGoal" type="text" />
        </label>
        <div className="today-actions">
          <button className="primary-action" type="submit">
            保存修改
          </button>
        </div>
      </form>

      {task.isActive ? (
        <form action={pauseTaskAction} className="inline-danger-form">
          <input name="id" type="hidden" value={task.id} />
          <button className="secondary-action" type="submit">
            暂停任务
          </button>
        </form>
      ) : null}
    </AppShell>
  );
}
