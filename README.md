# 第一千局｜斗牛长期性模拟实验室

依据《斗牛赌博模拟器_网页版需求文档_v0.1》重建的 Phase 1 网页版。项目只使用虚拟统计点数，不接入真实货币、支付或博彩后端。

## 已实现

- 54 张牌（含大小王）、每局洗牌、自动最优组牛、牌型比较与对称倍率结算
- 5 个席位、10 种下注策略、破产离席与点击补位
- 1× / 3× / 8× 自动模拟、荷官轮班、全桌统计
- 资金曲线、破产时长、观测收益率与显式零和校验
- Web Worker 后台运行 1,000 次蒙特卡洛实验
- 响应式布局、键盘焦点与 `prefers-reduced-motion`
- 教育目的提示、免责声明与求助资源

## 本地运行

```bash
npm install
npm run dev
```

构建和测试：

```bash
npm run build
npm test
```

## 上线

部署目标是 Cloudflare Workers。完整步骤、上线前待定事项、验收清单和回滚方法见 [`docs/上线手册.md`](docs/上线手册.md)。

```bash
npm run preview       # 本地用 workerd 跑生产包（http://127.0.0.1:8787）
npm run deploy:check  # 构建 + 测试 + lint + 打包预演，不上传
npm run deploy        # 同上，全部通过后部署（需先 wrangler login）
```

赌桌核心在 `lib/core/`，斗牛插件在 `lib/games/niuniu/`；规则与结算不依赖 React，可独立测试或迁移。


## 许可证

源代码以 [MIT 许可证](LICENSE) 开源。

“第一千局”这个名称、“千”字徽记，以及 `design/brand/`、`app/icon.svg`、`app/apple-icon.png`、`app/opengraph-image.png` 里的品牌图形**不在 MIT 许可范围内**。发布修改版时，请换用别的名称和徽记，以免被误认为本项目。详见 [TRADEMARKS.md](TRADEMARKS.md)。
