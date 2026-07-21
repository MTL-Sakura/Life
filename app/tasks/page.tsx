import Link from "next/link";
import { addTemplateToTodayAction } from "@/app/tasks/actions";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { getTaskLibrary } from "@/lib/data";

export default async function TasksPage() {
  const session = await requireSession();
  const tasks = await getTaskLibrary(session.userId);

  return (
    <AppShell active="tasks">
      <PageHeader eyebrow="任务库" title="把想坚持的事放进庭院">
        <Link className="primary-action link-action" href="/tasks/new">
          新建任务
        </Link>
      </PageHeader>

      <section className="toolbar-row" aria-label="筛选">
        <button aria-pressed="true" type="button">
          全部
        </button>
        <button type="button">学习</button>
        <button type="button">健身</button>
        <button type="button">生活</button>
        <button type="button">创作</button>
      </section>

      <section className="list-panel" aria-label="任务列表">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <article className="library-task" key={task.id}>
              <div>
                <h2>{task.title}</h2>
                <p>
                  {task.categoryLabel} · {task.difficultyLabel} · {task.repeatLabel}
                </p>
              </div>
              <div className="library-actions">
                <span>{task.isActive ? "启用" : "暂停"}</span>
                {task.isActive ? (
                  <form action={addTemplateToTodayAction}>
                    <input name="templateId" type="hidden" value={task.id} />
                    <button type="submit">加入今日</button>
                  </form>
                ) : null}
                <Link href={`/tasks/${task.id}/edit`}>编辑</Link>
              </div>
            </article>
          ))
        ) : (
          <article className="empty-panel">
            <h2>还没有任务</h2>
            <p>先创建一个最容易开始的任务。</p>
            <Link className="primary-action link-action" href="/tasks/new">
              新建任务
            </Link>
          </article>
        )}
      </section>
    </AppShell>
  );
}
