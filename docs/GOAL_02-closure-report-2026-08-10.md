# GOAL_02 结案报告：三层可插拔架构迁移
日期：2026-08-10  
执行者：Cursor Agent  
状态：**结案（自动验收全绿；浏览器人手测仍属 §五.2 待办）**

---

## 一、结论

已按冻结契约完成从单体 `lib/game/*` 到 `lib/core` + `lib/games/niuniu` 的迁移：

- 赌桌层：严格阶段状态机 + 统一 `dispatch`
- 游戏层：斗牛作为第一个 `GameModule` 插件
- 策略层：只产出 `place_bet`，与人类同一通道
- Worker：只编排，零结算公式；与桌面同种子 delta 序列一致

最终自动测试：**11 通过 / 0 失败**（`npm.cmd test` + `npm.cmd run lint`）。

---

## 二、每步 commit 与验收摘要

| Step | Commit | 说明 | 验收摘要 |
|---|---|---|---|
| 1 | `15f9bcc` | core 骨架（types/actions/game-module/rng/registry/table） | `build` + `lint` 绿 |
| 2 | `160934a` | 斗牛插件 kernel/module/strategies/view/index | `build` + `lint` + kernel 3 测绿 |
| 3 | `958537b` | table 契约测（非法/闸门/阶段/策略/零和） | 新增 contract 测绿 |
| 4 | `b2fce66` | Simulator 重接线 + playing-card | `npm.cmd test` 全绿（含 rendered-html） |
| 5 | `87dfb40` | Worker 重写 + 同种子一致性 | contract 同种子测绿 |
| 6 | `eb70a35` | 手动座位/注额 UI + 人机等价测 | build/lint + 人机等价测绿 |
| 7 | `0ea36ec` | 删除 `lib/game/*`，更新 PROJECT_CONTEXT / README | 最终 **11** 测绿、lint 绿 |

基线（迁移前）：`584f880 Rebuild educational Niuniu simulator from PRD`

---

## 三、契约落地冲突与拍板

| 冲突 | 选项 | 落地 |
|---|---|---|
| 策略删 maxLoss 缩放 vs「自动体验与旧版一致」 | **1A** | 超本金严格 `throw`；UI catch 后暂停。登记 R-10。 |
| `settle` 无本金参数 vs 旧公式封顶 | **2A** | `settle` 出理论 delta；`table` 应用时 `max(delta, -bankroll)` 并计入零和。 |

其余冻结签名与文件布局未改。实现中未再自行改设计。

附加行为差异（按契约，非冲突未决）：

- 荷官轮换：`round % 30 === 0` 递增（旧为 `floor(round/30)`）→ R-11。

---

## 四、未追踪文件对比（证明未动用户资产）

迁移开始前（对话初）与结案时，以下 **7** 个用户资产始终为 `??`，未被删除/覆盖：

1. `eldenring_test.png`
2. `mod_min_test.png`
3. `mod_nosave_test.png`
4. `mod_test.png`
5. `vanilla_test.png`
6. `test_nomenu.ps1`
7. `test_normal_nomenu.ps1`

结案时另有未提交项（非上述 7 件破坏，属本任务产物或既有文档）：

- `AGENTS.md`（既有未提交）
- `docs/`（含侦察报告与本结案报告）
- `一键打开.bat`（后续咨询新增，尚未 commit）
- `PROJECT_CONTEXT.md` 工作区有结案后登记的本地修改（相对 `0ea36ec`）

---

## 五、PROJECT_CONTEXT.md 差异说明（相对迁移前）

| 区块 | 变化 |
|---|---|
| 版本 | → **v1.5**（GOAL_02 完成） |
| §三 | 文件地图改为 `lib/core/*` + `lib/games/niuniu/*`；删除对 `lib/game/*` 的指向 |
| §四 | 新增 F-15（人机通道）、F-16（三层骨架）；N-3 改为「第二种游戏尚未做」 |
| §五 | 测试证据改为 11 项契约/kernel/外壳；§五.2 补人手测与 maxLoss UI |
| §六 | **关闭** R-7/R-8/R-9；**新增** R-10（1A）、R-11（荷官轮换） |
| §八 | GOAL_02 架构待办勾完；下一步侧重浏览器实测与是否发布 |
| §十 / §十二 | 指针与对话维护记录已同步 |

---

## 六、交付物清单（源码）

**新建**

- `lib/core/types.ts`、`actions.ts`、`game-module.ts`、`rng.ts`、`registry.ts`、`table.ts`、`auto-play.ts`
- `lib/games/niuniu/kernel.ts`、`module.ts`、`strategies.ts`、`view.ts`、`profiles.ts`、`index.ts`
- `app/components/playing-card.tsx`
- `tests/niuniu-kernel.test.mjs`、`tests/contract.test.mjs`

**重写**

- `app/components/Simulator.tsx`
- `workers/monte-carlo.worker.ts`
- `app/globals.css`（座位控制/下注控件样式）

**删除**

- `lib/game/niuniu.ts`、`simulation.ts`、`strategies.ts`
- `tests/engine.test.mjs`（断言已迁入新测）

---

## 七、未声称完成 / 建议下一步

1. 真实浏览器验收：自动模拟、人/机切换、人类下注、蒙特卡洛、移动端（§五.2）。
2. 低本金 + 高注策略触发 maxLoss 时的提示是否够用（R-10）。
3. 是否发布、访问范围（P-1 / U-1）。
4. 第一种新增游戏选型（N-3 / P-5）——接口已就绪，勿在未选游戏前扩 UI。

---

## 八、一句话结案

GOAL_02 冻结契约已落地、七步 commit 齐、自动验收全绿；产品可进入浏览器人手验收，不宜在此时宣称 Phase 1「真机验收完成」或已上线。
