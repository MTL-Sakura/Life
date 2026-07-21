import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { getCalendarData } from "@/lib/data";

export default async function CalendarPage() {
  const session = await requireSession();
  const calendar = await getCalendarData(session.userId);

  return (
    <AppShell active="calendar">
      <PageHeader eyebrow="日历" title="把一点点变成看得见的路" />

      <section className="calendar-layout">
        <div className="calendar-grid" aria-label={calendar.monthLabel}>
          {calendar.days.map((day) => (
            <button
              className={`calendar-day intensity-${day.intensity}`}
              key={day.day}
              type="button"
            >
              {day.day}
            </button>
          ))}
        </div>
        <aside className="daily-summary">
          <p className="eyebrow">{calendar.monthLabel}</p>
          {calendar.latestSummary ? (
            <>
              <h2>最近一次打卡：{calendar.latestSummary.tier}</h2>
              <ul>
                <li>获得 XP {calendar.latestSummary.xp}</li>
                <li>{calendar.latestSummary.attribute}</li>
              </ul>
            </>
          ) : (
            <>
              <h2>这个月还在等待第一束阳光</h2>
              <p>完成一个启动版任务后，这里就会亮起来。</p>
            </>
          )}
        </aside>
      </section>
    </AppShell>
  );
}
