import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const TITLE = "第一千局｜斗牛长期性模拟实验室";
const DESCRIPTION =
  "用可重复的斗牛模拟、资金曲线与破产概率，看清下注策略为何无法改变长期负期望。无真实货币，纯模拟，教育目的。";

/**
 * Social cards need absolute image URLs. The domain is not fixed yet (workers.dev
 * first, maybe a custom domain later), so the origin comes from the request's Host.
 */
async function siteOrigin(): Promise<URL> {
  const host = (await headers()).get("host") ?? "";
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return new URL("http://localhost");
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  return new URL(`${local ? "http" : "https"}://${host}`);
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    metadataBase: await siteOrigin(),
    title: TITLE,
    description: "无真实货币的互动概率教育工具。",
    applicationName: "第一千局",
    // Images come from app/opengraph-image.png and app/opengraph-image.alt.txt.
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "第一千局",
      title: TITLE,
      description: DESCRIPTION,
      url: "/",
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
    },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  themeColor: "#0b0b0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
