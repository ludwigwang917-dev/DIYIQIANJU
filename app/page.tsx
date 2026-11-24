import type { Metadata } from "next";
import Simulator from "./components/Simulator";

export const metadata: Metadata = {
  title: "第一千局｜斗牛长期性模拟实验室",
  description: "用可重复的斗牛模拟、资金曲线与破产概率，看清下注策略为何无法改变长期负期望。无真实货币，纯模拟，教育目的。",
};

export default function Home() {
  return <Simulator />;
}

