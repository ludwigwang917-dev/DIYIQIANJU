import type { ReactNode } from "react";

/**
 * Shell for the 404 and error pages. Like the main page, it keeps the
 * "no real money" notice and the help links visible.
 */
export default function StatusPage({
  code,
  title,
  children,
  action,
}: {
  code: string;
  title: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "48px 24px",
        boxSizing: "border-box",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 520 }}>
        <span className="pe-seal" style={{ margin: "0 auto 20px" }} aria-hidden="true">
          千
        </span>
        <p style={{ margin: 0, color: "var(--faint)", fontFamily: "var(--num)", letterSpacing: "0.2em" }}>{code}</p>
        <h1 style={{ margin: "8px 0 12px", font: "700 28px/1.35 var(--serif)", letterSpacing: "0.04em" }}>{title}</h1>
        <div style={{ color: "var(--muted)", lineHeight: 1.7 }}>{children}</div>
        <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>{action}</div>
        <div className="pe-badge" style={{ display: "inline-block", marginTop: 36 }}>
          <i /> 无真实货币 · 纯模拟 · 教育目的
        </div>
        <p style={{ marginTop: 16, fontSize: 13, color: "var(--faint)", lineHeight: 1.8 }}>
          如果赌博已经影响你的生活，请停止下注，和信任的人谈谈。
          <br />
          <a href="https://www.who.int/news-room/fact-sheets/detail/gambling" target="_blank" rel="noreferrer" style={{ color: "var(--brass)" }}>
            WHO 赌博危害说明 ↗
          </a>
          {"　"}
          <a href="https://gamblersanonymous.org/virtual-meetings/" target="_blank" rel="noreferrer" style={{ color: "var(--brass)" }}>
            匿名戒赌会线上互助 ↗
          </a>
        </p>
      </div>
    </main>
  );
}
