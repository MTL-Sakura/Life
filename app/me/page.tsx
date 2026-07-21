import { changePasswordAction } from "@/app/me/actions";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/lib/auth";
import { getProfileData } from "@/lib/data";

type MePageProps = {
  searchParams?: Promise<{
    password?: string;
  }>;
};

export default async function MePage({ searchParams }: MePageProps) {
  const session = await requireSession();
  const { profile, levelProgress, achievements } = await getProfileData(session.userId);
  const params = await searchParams;
  const attributes = [
    ["专注", profile.focus],
    ["体能", profile.fitness],
    ["秩序", profile.order],
    ["创造", profile.creativity],
    ["恢复", profile.recovery],
  ];

  return (
    <AppShell active="me">
      <PageHeader eyebrow="我的" title={`${session.username} 的成长记录`} />

      <section className="profile-grid">
        <article className="profile-panel">
          <h2>Lv. {profile.level}</h2>
          <p>连续照顾 {profile.currentStreak} 天</p>
          <div className="progress-track">
            <span style={{ width: `${levelProgress.percent}%` }} />
          </div>
        </article>

        <article className="profile-panel">
          <h2>属性</h2>
          <div className="attribute-list">
            {attributes.map(([name, value]) => (
              <div key={name}>
                <span>{name}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="profile-panel">
          <h2>成就</h2>
          <p>
            {achievements.length > 0
              ? achievements.map((achievement) => achievement.title).join(" · ")
              : "第一束阳光还在路上"}
          </p>
        </article>

        <form action={changePasswordAction} className="profile-panel">
          <h2>修改密码</h2>
          <label>
            当前密码
            <input name="currentPassword" type="password" />
          </label>
          <label>
            新密码
            <input name="nextPassword" type="password" />
          </label>
          {params?.password ? (
            <p className={params.password === "updated" ? "form-success" : "form-error"}>
              {getPasswordMessage(params.password)}
            </p>
          ) : null}
          <button className="primary-action" type="submit">
            保存密码
          </button>
        </form>
      </section>
    </AppShell>
  );
}

function getPasswordMessage(status: string) {
  if (status === "updated") {
    return "密码已经更新。";
  }

  if (status === "wrong") {
    return "当前密码不正确。";
  }

  return "新密码至少需要 8 位。";
}
