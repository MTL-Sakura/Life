import Link from "next/link";
import { logoutAction } from "@/app/actions";

type NavKey = "today" | "tasks" | "garden" | "calendar" | "me";

const navItems: Array<{
  key: NavKey;
  href: string;
  label: string;
  icon: string;
}> = [
  { key: "today", href: "/", label: "今日", icon: "✦" },
  { key: "tasks", href: "/tasks", label: "任务", icon: "＋" },
  { key: "garden", href: "/garden", label: "庭院", icon: "花" },
  { key: "calendar", href: "/calendar", label: "日历", icon: "□" },
  { key: "me", href: "/me", label: "我的", icon: "人" },
];

export function AppShell({
  active,
  children,
}: {
  active: NavKey;
  children: React.ReactNode;
}) {
  return (
    <main className="app-shell">
      <aside className="side-nav" aria-label="主导航">
        <Link className="brand-mark" href="/">
          <span className="brand-symbol">桜</span>
          <span>Sakura Life</span>
        </Link>
        <nav>
          {navItems.map((item) => (
            <Link
              aria-current={active === item.key ? "page" : undefined}
              className="nav-item"
              href={item.href}
              key={item.key}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <form action={logoutAction}>
          <button className="nav-item logout-button" type="submit">
            <span className="nav-icon" aria-hidden="true">
              ↺
            </span>
            <span>退出</span>
          </button>
        </form>
      </aside>

      <div className="content-shell">{children}</div>

      <nav className="bottom-nav" aria-label="主导航">
        {navItems.map((item) => (
          <Link
            aria-current={active === item.key ? "page" : undefined}
            className="bottom-nav-item"
            href={item.href}
            key={item.key}
          >
            <span aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
