# 架构总览 · 代码结构

版本：v0.1（结构优先阶段）

本目录说明代码如何组织：模块职责、依赖方向、端到端数据流、各部分的实现状态，以及关键决策和未完成项（[ADR](adr/README.md)、[扩展点与未完成项](extension-points.md)）。概念架构见 [01 系统架构说明](../01-system-architecture.md)。

> **现状**
>
> 代码是一个可以运行的结构骨架。确定性规则已经写成真实代码：状态机、Policy Gate、质量闸门判定、数据约束、基线与指标。不过它们运行在合成数据、合成 CAD 和脚本 agent 之上。
>
> 目前没有：独立的后端服务、模型调用、与任何 CAD 软件的连接、模型训练，也没有任何临床或研究结论。
>
> 文中的「05」「06」指 `docs/05-agent-runtime-spec.md` v0.2 与 `docs/06-research-browser-mcp.md` v0.1。二者只在 PR #3（分支 `claude/sharp-hawking-4p3e5y`）中，`main` 上还没有。05/06 修订或合并后，需要复核引用它们的类型与规则。

## 1. 模块与职责

| 层 | 位置 | 负责 | 不负责 | 实现状态 |
|---|---|---|---|---|
| 契约 | `packages/contracts` | 跨层共享的类型与少量纯规则：UI ↔ Runtime 端口（`RuntimeClient`、`ApprovalChannel`、`HumanFeedbackChannel`、`RecordsClient`）、任务与步骤状态、事件信封、候选、质量闸门、审批、统一错误形状 `ErrorInfo`、`isGatePassed`（失败即关闭） | I/O、流程 | 类型与纯函数 |
| Data Layer | `packages/data` | 02 数据模型（病例、分配、会话、追加式设计版本图、EditAction、CorrectionEpisode、GeometryDelta、OutcomeRecord）。写入约束：一个病例只分配给一位牙技师；只有负责牙技师能编辑、撤销和确认；Copilot 写入必须带审批。另有查询、投影和合成数据集 | 判断修改是否正确；把差异解释为偏好 | 约束是真实代码；存储在内存中，数据是合成的 |
| Agent-Tool Layer | `packages/agent-tools` | 工具定义（级别、角色、模式、数据范围、外发类别、超时）；工具目录与按运行模式注册；Agent 接口（agent 只能经 `AgentSession` 提出计划和步骤）；外部系统端口 `CadPort`、`ModelProvider`、`ResearchBrowserPort` 与 `AdapterError` | 执行工具、授权、状态转移 | 接口与目录 |
| Research Layer | `packages/research` | 实验登记草案；按 `as_of` 截止、排除同一患者的历史视图；03 §5 基线（P_self / P_pop 区域平均，M / G 相似病例检索，L 占位）；T1 / T2 指标，以病例为分析单位；按患者划分；「一病例一牙技师」下的设计诊断 | 决定样本量或每人病例数；运行时决策 | 基线与指标已实现，只在合成数据上运行过；L 未实现 |
| Runtime | `packages/runtime` | `engine/`：05 §6.3 / §6.5 状态机、Policy Gate、步骤执行协议、审批绑定与一次性消费、预算、事件日志，详见第 3 节。`host/`：在引擎之上实现全部 UI 端口。`simulation/`：合成 CAD、脚本模型、fixture Research Browser、模拟工具、脚本 agent，以及用故障计划表达的场景 | 评价长期效果；生成或验证几何 | `engine/` 与 `host/` 是真实代码，在浏览器进程内运行；`simulation/` 全部是模拟 |
| Integration Layer | `packages/integrations` | 与仓库外系统的边界：HTTP/SSE Runtime 传输（路由表覆盖每个端口方法）、真实牙科 CAD、Research-Browser-MCP 客户端、外部模型提供方 | 发出任何实际的外部调用 | 全部是占位，调用即以 `NOT_IMPLEMENTED` 或 `NOT_CONFIGURED` 失败 |
| Frontend | `apps/web/src/ui` | 牙技师工作区：任务、计划、候选审阅、审批、阻塞处理、病例记录、诊断；控件由 Runtime 声明的能力决定 | 推导任务状态；判断审批是否有效 | 真实 UI，连接模拟 Runtime |
| 组装层 | `apps/web/src/app` | 选择 Runtime：`VITE_RUNTIME_TRANSPORT` 为 `simulated`（默认，进程内）或 `http`（占位）；只在模拟部署中显示原型控制面板 | 产品功能 | — |

01 的概念层与代码的对应：

| 01 §1 / §4 | 代码 | 说明 |
|---|---|---|
| 数据层 | `packages/data` | |
| 几何引擎（确定性） | 尚无独立模块 | 对应状态、位移和闸门检查目前由 `runtime/src/simulation/tools.ts` 中的模拟工具给出；见扩展点 X7 |
| 经验库（检索） | `research/src/history.ts` + 工具 `memory.query_history` | |
| 预测 / 推理层 | `research/src/predictors.ts`（候选来源）+ `agent-tools/src/agent`（任务组织） | 模型输出不具权威；候选只来自 `candidate_source` 工具（[ADR-0006](adr/0006-agent-tool-boundary.md)） |
| Runtime Harness | `packages/runtime` | 回滚尚未实现，见扩展点 X10 |
| Evaluation Harness | `research/src/metrics.ts`、`split.ts`、`design.ts` | 只有指标、划分与设计诊断；历史重放、密封评估和回归尚未实现，见扩展点 X9 |

## 2. 依赖方向

```
web/app ──┬──▶ runtime ──┬──▶ research ──▶ data
          │              ├──▶ data
          │              └──▶ agent-tools
          ├──▶ integrations ──▶ agent-tools
          └──▶ web/ui

所有模块都可以依赖 contracts；图中没有的依赖一律禁止。
```

要点（[ADR-0001](adr/0001-workspace-modules.md)）：

- `web/ui` 只依赖契约，所以 UI 不知道 Runtime 是否是模拟的。换成真实 Runtime 时只改 `web/app`。
- `integrations` 实现 `agent-tools` 中定义的端口。它与 `runtime` 互不依赖，由组装层（或将来的 Runtime 服务）把适配器注入 `RuntimeEnvironment`。
- `agent-tools` 不依赖 `runtime` 和 `data`，所以工具与 agent 的接口不绑定某一种 Runtime 或存储实现。

`npm run check:boundaries`（`scripts/check-boundaries.mjs`）逐个源文件检查：

1. 内部依赖符合上图；
2. 相对路径 import 不离开本层目录；
3. 第三方依赖在白名单内：领域包没有运行时第三方依赖，测试只能用 `vitest`；Web 只能用 React 和测试库；
4. 共享源码不使用 `node:` 内置模块，以便同一份代码既能在浏览器运行，也能放进将来的服务进程；
5. 每个内部依赖都在所属 `package.json` 中声明，且包不声明本层不允许的依赖。

## 3. 端到端数据流（模拟部署）

以 assist-execute 模式的「标准流程」为例。括号里是代码位置。

```
牙技师                  web/ui                     runtime/host + engine                    data / simulation
  │ 选病例、描述任务     │                                │                                          │
  │────────────────────▶│ createTask ───────────────────▶│ requireAssigned：病例必须分配给登录者     │
  │                     │                                │ TaskRun（CREATED）· setupTask 选 agent ──▶│ 场景 = 故障计划 + 脚本 agent
  │                     │◀── TaskUpdate（快照 + 新事件）──│ agent 经 AgentSession 写计划（PLANNING）  │
  │                     │                                │ 每一步：Policy Gate → 执行工具 ──────────▶│ 合成 CAD / 数据层 / 基线
  │                     │◀── 候选、闸门结果、审批请求 ─────│ E 级写入：AWAITING_APPROVAL               │
  │ 二次确认后批准       │                                │                                          │
  │────────────────────▶│ submitDecision（独立通道）────▶│ ApprovalRecorded（绑定候选哈希与基础版本）│
  │                     │                                │ 执行前核对基础版本 → 意图记录 → 条件写入 ─▶│ 新 DesignVersion（origin = copilot_execution，
  │                     │◀── TaskUpdate ─────────────────│ SUCCEEDED → … → COMPLETED                │   带 approvalId 与 taskId）+ EditAction
  │                     │◀── subscribeCase 通知 ─────────────────────────────────────────────────────│
  │                     │ 病例记录面板重新读取 getCaseRecord                                         │
```

1. **创建任务**：`NewTaskComposer` 调用 `RuntimeClient.createTask`。`InProcessRuntime` 先检查病例是否分配给当前登录的牙技师，未分配时返回 `FORBIDDEN`（[ADR-0003](adr/0003-one-technician-per-case.md)）。然后创建 `TaskRun`，由 `RuntimeEnvironment.setupTask` 选择 agent。在模拟环境中，所选场景决定 agent 与故障计划（`runtime/src/simulation/scenarios.ts`）。
2. **计划**：agent 只能经 `AgentSession` 写计划和请求执行步骤。计划先经 Policy Gate 预检（`precheckPlan`），工具必须已在当前模式下注册。
3. **执行**：`StepExecutor` 是唯一调用工具的代码。每一步依次经过：
   - Policy Gate（`checkStep`：级别、角色、模式、外发类别）；
   - E 级步骤的审批与执行前基础版本核对；
   - 有副作用步骤的意图记录；
   - 执行工具；
   - 按 §7.3 处理结果：无副作用的失败在 `max_attempts` 内重试；结果不明时先对账，不自动重试。
   候选只能来自 `candidate_source` 工具，并在 `TaskRun` 中登记哈希。展示步骤由 Policy Gate 按闸门结果放行：未通过的候选只能作为诊断提示，去掉几何与逐点位移。
4. **审批**：审批请求绑定候选哈希、基础版本、执行工具与策略版本。决定只能经 `ApprovalChannel` 提交，对话消息不构成审批（I4）。Runtime 写入 `ApprovalRecorded` 之后，UI 才显示「已批准」。审批在意图记录处一次性消费。基础版本变化时，审批作废并重新规划。
5. **写入与记录**：合成 CAD 执行条件写入，同时充当采集适配器，在数据层追加新版本与 EditAction，`actor` 为 copilot 并带 `approvalId`（[ADR-0005](adr/0005-append-only-version-graph.md)）。审批等待期间牙技师在 CAD 中的编辑，记为该牙技师自己的版本。执行前核对发现基础版本已变时，审批作废，步骤被拒绝，然后重新规划。如果核对之后、写入之前版本又变了，条件写入会拒绝执行（FAILED_NO_EFFECT），审批同样作废。
6. **事件到界面**：每次状态变化都在任务事件日志中追加一条 `EventEnvelope`（`seq` 递增，带哈希链），并向订阅者发布 `TaskUpdate`（快照 + 新事件）。UI 的 `useTask` 合并更新后渲染，界面不自行推导状态。数据层的变更经 `RecordsClient.subscribeCase` 通知病例记录面板。
7. **结束**：任务 COMPLETED，结果条写明「已写入 CAD」。最终确认是牙技师的操作，只能由负责牙技师在数据层确认，Copilot 不会确认。

脚本模型的每次叙述都按 05 §7.4 记录为一次模型调用（`ModelCallRecorded`，快照中的 `modelCalls`），诊断面板标明「脚本，未调用模型」。

所有错误都归一为 `ErrorInfo { layer, code, message, retryable }`（`contracts/src/errors.ts`）。UI 显示错误码，只对 `retryable` 的错误提供重试。

## 4. 实现状态

| 部分 | 状态 | 位置 |
|---|---|---|
| 任务 / 步骤状态机、Policy Gate、步骤执行协议、审批绑定、事件日志 | 真实代码，进程内运行 | `runtime/src/engine` |
| UI 端口的进程内实现 | 真实代码；没有认证，没有持久化 | `runtime/src/host` |
| 数据模型与写入约束 | 真实代码 | `data/src/model.ts`、`memoryStore.ts` |
| 存储 | 模拟：内存，刷新即重置 | `data/src/memoryStore.ts` |
| 病例、牙技师、历史病例 | 模拟：合成数据集，生成假设在 UI 中可见 | `data/src/synthetic.ts` |
| 基线预测器 P / M / G、T1 / T2 指标、按患者划分、设计诊断 | 真实代码，只在合成数据上运行过 | `research/src` |
| 学习型预测器 L | 占位：调用即失败 | `research/src/predictors.ts` |
| 几何（对应状态、位移、闸门检查） | 模拟：由合成数据生成，没有几何计算 | `runtime/src/simulation/tools.ts` |
| CAD | 模拟：合成 CAD，支持版本查询、条件写入与故障注入。真实适配器只有占位 | `runtime/src/simulation/syntheticCad.ts`、`integrations/src/cad` |
| 模型 | 模拟：脚本叙述，没有模型调用。外部提供方只有占位 | `runtime/src/simulation/scriptedModel.ts`、`integrations/src/model` |
| Research Browser | 模拟：fixture 结果。MCP 客户端只有占位 | `runtime/src/simulation/fixtureResearchBrowser.ts`、`integrations/src/research-browser` |
| 网络传输（HTTP/SSE） | 占位：路由表已定义，调用即以 `NOT_IMPLEMENTED` 失败 | `integrations/src/runtime-transport` |
| 牙技师界面 | 真实 UI，连接模拟 Runtime | `apps/web/src/ui` |

诊断面板的「集成与适配器」逐项显示上述状态（模拟 / 占位 / 已连接），页头显示还有几项没有接入真实系统。

## 5. 运行与检查

```bash
npm ci
npm run dev               # 前端 + 进程内模拟 Runtime
npm run check             # 模块边界 + 全部包的类型检查 + 全部测试
npm run build             # 前端生产构建
npx vitest run --project @cadcopilot/runtime   # 只跑某个包的测试
```

用 `VITE_RUNTIME_TRANSPORT=http npm run dev` 可以看到 HTTP 占位：界面显示 `NOT_IMPLEMENTED`，不提供重试，也不显示任何任务状态。

## 6. 文档索引

- [决策记录（ADR）](adr/README.md)
- [扩展点与未完成项](extension-points.md)：真实系统接入、未来功能、规范缺口、研究设计上的未决事项
- [前端原型说明](../../apps/web/README.md)
