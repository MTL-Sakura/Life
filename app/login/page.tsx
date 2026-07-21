import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loginAction } from "./actions";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();

  if (session) {
    redirect("/");
  }

  const params = await searchParams;
  const error = params?.error;

  return (
    <main className="login-page">
      <section className="login-illustration" aria-hidden="true">
        <div className="login-sky" />
        <div className="login-tree">
          <span className="login-blossom login-blossom-one" />
          <span className="login-blossom login-blossom-two" />
          <span className="login-blossom login-blossom-three" />
          <span className="login-trunk" />
        </div>
        <div className="login-ground" />
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <p className="eyebrow">Sakura Life</p>
        <h1 id="login-title">今天也照顾一点点</h1>
        <form action={loginAction} className="login-form">
          <label>
            用户名
            <input
              autoComplete="username"
              name="username"
              placeholder="sakura"
              required
              type="text"
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              name="password"
              placeholder="输入密码"
              required
              type="password"
            />
          </label>
          {error ? (
            <p className="form-error">
              {error === "missing" ? "请填写用户名和密码。" : "账号或密码不正确。"}
            </p>
          ) : null}
          <button className="primary-action" type="submit">
            进入庭院
          </button>
        </form>
      </section>
    </main>
  );
}
