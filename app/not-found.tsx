import Link from "next/link";
import StatusPage from "./components/status-page";

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="这张桌子不存在"
      action={
        <Link className="pe-btn pe-btn--primary" href="/" style={{ display: "inline-grid", placeItems: "center", textDecoration: "none" }}>
          回到牌桌
        </Link>
      }
    >
      你要找的页面不在这里。牌桌只有一张入口，就在首页。
    </StatusPage>
  );
}
