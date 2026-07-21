import { createTaskAction } from "@/app/tasks/actions";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";

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

type NewTaskPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function NewTaskPage({ searchParams }: NewTaskPageProps) {
  await requireSession();
  const params = await searchParams;

  return (
    <AppShell active="tasks">
      <PageHeader eyebrow="新建任务" title="给庭院准备新的阳光" />

      <form action={createTaskAction} className="task-form">
        <label>
          任务名称
          <input name="title" placeholder="例如：学习日语 30 分钟" required type="text" />
        </label>

        <div className="form-grid">
          <label>
            分类
            <select defaultValue="STUDY" name="category">
              {categories.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            难度
            <select defaultValue="NORMAL" name="difficulty">
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
          <select defaultValue="DAILY" name="repeatRule">
            <option value="NONE">不重复</option>
            <option value="DAILY">每天</option>
            <option value="WEEKLY">每周</option>
          </select>
        </label>

        <label>
          启动版
          <input name="starterGoal" placeholder="例如：打开课程，坚持 5 分钟" required type="text" />
        </label>

        <label>
          标准版
          <input name="standardGoal" placeholder="例如：专注学习 30 分钟" required type="text" />
        </label>

        <label>
          超额版
          <input name="bonusGoal" placeholder="例如：专注学习 90 分钟" type="text" />
        </label>

        <label className="check-row">
          <input name="addToToday" type="checkbox" defaultChecked />
          今天就加入
        </label>

        {params?.error === "missing" ? (
          <p className="form-error">请至少填写任务名称、启动版和标准版。</p>
        ) : null}

        <div className="today-actions">
          <button className="primary-action" type="submit">
            保存任务
          </button>
          <button className="secondary-action" type="reset">
            清空
          </button>
        </div>
      </form>
    </AppShell>
  );
}
