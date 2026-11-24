"use client";

import StatusPage from "./components/status-page";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPage
      code="出错了"
      title="牌桌出了点问题"
      action={
        <>
          <button className="pe-btn pe-btn--primary" onClick={() => reset()}>
            重新开桌
          </button>
          <button className="pe-btn" onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </>
      }
    >
      页面运行时遇到了错误。重新开桌会从头开始，之前的模拟数据不会保留。
      {error.digest ? (
        <>
          <br />
          <small style={{ color: "var(--faint)" }}>错误编号：{error.digest}</small>
        </>
      ) : null}
    </StatusPage>
  );
}
