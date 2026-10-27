# 扩展点与未完成项

版本：v0.1

本文件记录四类内容：

- 接入真实系统需要替换的位置；
- 当前有意不提供的功能；
- 规范缺口和代码里的临时做法；
- 会影响数据结构的研究设计未决事项。

每个扩展点都写明现状、接入方式、前置条件，以及不能为了接入而放宽的约束。所有临时做法都是可逆的。

「05」「06」的含义见[架构总览](README.md)。PR #3 与 PR #4 使用了相同的 Q 编号，但含义不同（[ADR-0007](adr/0007-question-numbering-conflict.md)）。下文引用这两个 PR 中的 Q 编号时，都写明出自哪个 PR。

## 1. 接入真实系统

### X1 · Runtime 网络传输（HTTP/SSE）与独立 Runtime 服务

- **现状**：
  - `integrations/src/runtime-transport/http.ts` 中的 `RUNTIME_HTTP_ROUTES` 为每个端口方法给出路由。`satisfies` 约束保证新增端口方法时，编译器会要求补上路由。
  - `createHttpRuntimePorts` 是占位，每个调用都以不可重试的 `NOT_IMPLEMENTED` 失败。
  - `runtime/src/host/inProcessRuntime.ts` 已经实现全部端口，只是运行在浏览器进程内。
- **接入**：
  1. 客户端：用 `fetch` 和 SSE 实现 `createHttpRuntimePorts`，断线后从最后的 `seq` 续读。HTTP 错误映射为 `RuntimeClientError` 的错误码（B12）。
  2. 服务端：新增一个应用（例如 `apps/runtime-service`），在路由后面托管 `InProcessRuntime`，并注入真实的 `RuntimeEnvironment`。审批通道单独认证（I4）。
  3. 组装层：`VITE_RUNTIME_TRANSPORT=http` 已经能切换到这条路径，UI 不需要改动。
- **前置**：
  - 快照结构与事件类型枚举（B3、B4）；
  - 身份与认证（X6）；
  - Runtime 部署在哪里（PR #3 的 Q14）。
- **不能放宽**：
  - 审批只来自审批记录；
  - 对话不经过审批通道；
  - 快照由 Runtime 给出，客户端不推导状态。

接入真实 Runtime 时，前端需要以下接口。标「待定义」的部分 05 没有规定，现有类型只是提议，需要与后端共同确定。

| # | 接口 | 路由（`RUNTIME_HTTP_ROUTES`） | 内容 | 依据 / 状态 |
|---|---|---|---|---|
| B1 | 部署信息 | `GET /v0/deployment` | 运行模式；已注册工具（含级别与副作用）；能力开关；策略与闸门标准集版本；当前身份及是否已认证；各集成的实现状态 | 05 §4、§7.1；能力开关与 `integrations` **待定义** |
| B2 | 病例列表 | `GET /v0/cases` | 分配给当前牙技师、尚未确认的假名化病例摘要 | 02 §1、§6.5，04 §1.2，[ADR-0003](adr/0003-one-technician-per-case.md) |
| B3 | 任务快照 | `GET /v0/tasks/:taskId` | 事件日志的投影：任务状态与阻塞报告、计划、步骤与每次尝试、候选、决策记录、审批请求、预算、版本、模型调用 | 05 §6.1、§7.4、§9.3、§11；快照结构**待定义** |
| B4 | 事件流 | `GET /v0/tasks/:taskId/events`、`…/stream`（SSE） | 按 `seq` 增量读取与订阅，断线续读 | 05 §5.1；事件类型**待定义**（提议见 `contracts/src/events.ts`） |
| B5 | 创建任务 | `POST /v0/tasks` | `prompt` 和可选的 `caseId`，返回初始快照；病例未分配给请求者时返回 `FORBIDDEN` | 05 §6.2 |
| B6 | 对话消息 | `POST /v0/tasks/:taskId/messages` | 存为数据，不具有任何权限 | I11；存放层**待定义**（G4） |
| B7 | 取消 | `POST /v0/tasks/:taskId/cancel` | 人工取消 | 05 §6.3；进行中写入的语义**待定义**（G9） |
| B8 | 审批请求读取 | 包含在快照中 | 待决审批请求的完整范围：候选哈希、基础版本与范围、来源、闸门引用、策略版本、有效期 | 05 §10.3 只定义了审批记录；「审批请求」对象**待定义**（G6） |
| B9 | 审批决定 | `POST /v0/approvals/:id/decision`（独立认证通道） | 批准、拒绝或要求修改。回传候选哈希与基础版本 ID，防止基于过时数据决定 | 05 §10.3、I4；「要求修改」**待定义**（G8）；审批人与有效期未决（PR #3 的 Q17） |
| B10 | 人工回应 | `POST /v0/tasks/:taskId/feedback` | 绑定任务与当前阻塞原因的回应：继续、改写计划、人工对账已生效或未生效 | 05 §6.4，06 §3；`allowedResponses` **待定义**（G7） |
| B11 | 候选展示载荷 | 包含在快照中 | 区域（S_0 归一化弧长与对应状态）、偏好估计、逐项闸门结果。候选几何只对通过闸门的候选下发 | 05 §10.7，02 §9–§11；几何展示格式**待定义** |
| B12 | 错误模型 | 全部路由 | 请求级错误码（不可用、未认证、无权限、不存在、冲突、无效请求、未实现）与步骤级错误码，统一为 `ErrorInfo` | 05 §7.3；请求级错误码**待定义** |
| B13 | 病例记录 | `GET /v0/cases/:caseId/record`、`…/stream`（SSE） | 负责牙技师与分配规则、设计版本图及每个版本的来源、操作记录、几何差异、确认状态、病例协变量 | 02；投影见 `data/src/projections.ts` |

### X2 · 真实牙科 CAD 适配器

- **现状**：
  - 端口 `CadPort` 定义在 `agent-tools/src/ports/cad.ts`，需要声明自己的能力：读取设计、版本查询、条件写入、编辑事件、采集粒度。
  - `ExternalCadAdapterPlaceholder` 的所有能力都是 `unknown`，所有调用都以 `NOT_IMPLEMENTED` 失败。
  - `CAD_INTERFACE_AUDIT` 列出接口审计必须回答的问题。
  - 模拟工具（`runtime/src/simulation/tools.ts`）的类型绑定在 `SyntheticCadAdapter` 上，但只调用 `CadPort` 的方法，另外加上故障注入钩子。
- **接入**：
  1. 先按 05 §15 Phase 3a 做只读接口审计，不使用真实患者数据。
  2. 根据审计结果实现 `CadPort`，并实现一个采集适配器：按实际达到的采集粒度（C0–C3），把版本和操作写入数据层，就像合成 CAD 现在做的那样。
  3. 把 CAD 工具从 `SyntheticCadAdapter` 泛化为 `CadPort`，放进真实环境的工具集。
  4. 没有条件写入时，按能力声明改为「写后立即读取并对账」。
- **前置**：
  - 选定 CAD 软件（Q1：PR #3 列为候选、PR #4 记为部分决定的都是 3Shape，具体产品与版本待确认）；
  - 导出格式与授权（PR #4 的 Q13）。
- **不能放宽**：
  - 没有审批不写入；
  - 能力未经审计时保持 `unknown`，不假设。

### X3 · Research-Browser-MCP 客户端

- **现状**：
  - 端口 `ResearchBrowserPort` 定义在 `agent-tools/src/ports/researchBrowser.ts`，按 06 设计。
  - `ResearchBrowserMcpClientPlaceholder` 默认关闭，调用返回 `NOT_CONFIGURED`；启用后返回 `NOT_IMPLEMENTED`。
  - `RESEARCH_BROWSER_MCP_TOOLS` 记录端口方法与 MCP 工具名的对应。
  - 模拟环境使用 fixture 结果。
- **接入**：
  1. 在 `integrations` 中实现 MCP 客户端（stdio 或 HTTP）。
  2. 研究工具只在 offline-research 模式注册（工具目录已强制）。
  3. 外发类别 `public_query` 由 Policy Gate 检查。
- **前置**：
  - 与 Research-Browser-MCP 仓库核对工具名与返回结构；
  - 完成 06 §6 的 provider 与外发审查。
- **不能放宽**：
  - 不把服务端代码复制或合并进本仓库（[ADR-0004](adr/0004-ports-and-adapters.md)）；
  - MCP 是传输方式，不是权限边界；
  - 访问挑战（CAPTCHA 等）不自动求解。

### X4 · 模型提供方

- **现状**：
  - 端口 `ModelProvider` 定义在 `agent-tools/src/ports/model.ts`，含 05 §7.4 的调用记录。
  - 模拟环境使用脚本叙述，不调用模型。
  - `ExternalModelProviderPlaceholder` 返回 `NOT_CONFIGURED`。
- **接入**：
  1. 在 `integrations` 中实现提供方，声明外发的数据类别，由 Policy Gate 检查。
  2. 每次调用都记录。
- **前置**：是否使用外部模型 API，以及允许外发哪些数据类别（PR #3 的 Q15）。
- **不能放宽**：
  - 模型输出不具权威，不能产生候选、审批或状态转移（[ADR-0006](adr/0006-agent-tool-boundary.md)）。

### X5 · 持久化

- **现状**：`InMemoryDataStore` 与任务事件日志都在内存中，刷新即重置。
- **接入**：
  1. 实现基于数据库的 `DataStore`（`data/src/store.ts` 中的读写接口）。写入约束要在存储层再强制一次，不只依赖应用代码。
  2. 任务事件日志改为追加式存储，并保留哈希链。
- **前置**：
  - 数据驻留与适用法规（Q5、PR #3 的 Q14）；
  - 保留与删除政策（PR #3 的 Q16）；
  - 患者假名映射的保管人（PR #3 的 Q19）。

### X6 · 身份与认证

- **现状**：
  - 模拟部署中的身份未经认证，界面标明「审批无实际效力」。
  - 非模拟部署拒绝未认证身份的批准：Runtime host 和 UI 各检查一次。
- **接入**：在传输层认证；审批通道单独认证。
- **前置**：E 级审批由谁授予、有效期多长（PR #3 的 Q17）。

### X7 · 确定性几何引擎

- **现状**：没有。对应状态、位移和闸门检查结果由模拟工具从合成数据给出，没有任何几何计算。
- **接入**：
  1. 新增只依赖 `contracts` 的包（例如 `packages/geometry`），实现局部坐标系、曲线对应、法向位移和闸门检查项。
  2. 工具 `geometry.correspondence` 与 `geometry.quality_gate` 改为调用它。
- **前置**：
  - 02 §9–§11 的几何假设经先导数据验证；
  - 参考轴（Q8）；
  - 闸门硬性失败条件与阈值（Q9）。当前的 40 μm 只是模拟值。

### X8 · 学习型预测器 L

- **现状**：`PersonalLearningPredictor` 是占位，调用即失败。
- **前置**：
  - 有足够的数据量（每位牙技师的病例数尚未确认，见 R1）；
  - 先证明相对检索基线 M 有额外价值（01 §6 设计决定 2）。

### X9 · Evaluation Harness

- **现状**：只有指标、按患者划分和设计诊断。
- **接入**：
  - 基于设计版本图的历史重放；
  - 密封测试集；
  - 评估前冻结的登记记录；
  - 回归测试。
- **前置**：03 的终点与登记流程定稿。

## 2. 当前界面有意不提供的功能

这些功能需要先定义后端接口。不提供时，界面也不显示无法执行的控件。

| # | 功能 | 现有结构 | 缺什么 |
|---|---|---|---|
| X10 | E 级回滚 | 追加式版本图已经能表示「回到某个版本」（`undo`，带 `revertsTo`），目前只有牙技师能这样做 | 回滚本身是需要审批的 E 级动作（04 §4）：需要回滚工具（`cad_write` 角色）以及绑定目标版本的审批范围 |
| X11 | 追加预算 | BLOCKED(budget) 时界面只能取消 | 05 §6.4 把追加预算列为解除条件之一，但没有规定由谁、经什么通道操作 |
| X12 | 冲突解决 | `conflict` 阻塞由通用阻塞提示显示，没有模拟场景 | 05 §12 规定模型不能自行解决冲突，人工解决的通道未定义 |
| X13 | assist 模式的采纳 / 拒绝反馈 | 01 §5 的决策记录包含 Verification（人工确认或拒绝的结果） | 03 §3.1 的实际接受率需要它；端口、事件以及 `DecisionRecord` 上的 Verification 字段都未定义 |
| X14 | 研究人员视图 | `research` 包可以计算 | 工作假设、Knowledge Store、密封评估的查看界面，不放在牙技师工作区内 |

## 3. 规范缺口与临时做法

| # | 缺口 | 临时做法 | 位置 |
|---|---|---|---|
| G1 | 05 §6.3 没有「计划提前结束」的转移，例如检索没有返回任何来源 | 研究 agent 抛错，任务按 G2 以 FAILED 结束 | `runtime/src/simulation/agents/researchAgent.ts` |
| G2 | 05 §6.3 没有 Runtime 内部错误的转移 | `TaskRun.markFault` 绕过转移表直接置为 FAILED，并在事件日志中记录原因 | `runtime/src/engine/taskRun.ts` |
| G3 | 「循环轮数」预算的强制点未定义 | 只计数、显示；重新规划与工具调用的预算已强制，耗尽即 BLOCKED(budget) | `runtime/src/engine/taskRun.ts` |
| G4 | 对话消息的存放层未定义 | 作为 `MessagePosted` 事件存在任务事件日志中，不具任何权限 | `runtime/src/engine/taskRun.ts` |
| G5 | 事件类型没有枚举 | 提议的枚举 | `contracts/src/events.ts` |
| G6 | 「审批请求」对象未定义，05 只定义了审批记录 | 提议的 `ApprovalRequest`，与 §10.3 的审批范围一一对应 | `contracts/src/approvals.ts` |
| G7 | 阻塞报告没有「可接受的回应」 | 提议的 `BlockedReport.allowedResponses`；界面只提供列出的回应 | `contracts/src/task.ts` |
| G8 | 「要求修改」的语义 | 等于拒绝加上一条必填的修改意见，由 Runtime 一次处理 | `runtime/src/host/inProcessRuntime.ts` |
| G9 | 取消对进行中的有副作用步骤如何生效 | 在下一个安全点生效；有副作用的调用不可中断，不打断意图记录与对账之间的写入 | `runtime/src/engine/stepExecutor.ts` |

`contracts` 中注明「frontend proposal」的类型，都是 05 没有规定、由界面需要而提出的结构，需要与后端共同确认。

## 4. 影响数据结构的研究设计未决事项

| # | 事项 | 当前处理 |
|---|---|---|
| R1 | 每位牙技师的病例数量 | 待确认，不作为最终方案。合成数据集中每人 6 个历史病例只是演示参数（`historicalCasesPerTechnician`）；登记草案中为 `to_be_confirmed`；设计诊断不预设病例数 |
| R2 | PR #4（「采用标准病例设计，新增 H0 个人差异存在性」）设想同一组标准病例由每位牙技师修正，并安排间隔 ≥ 2 周的重复会话；这与「一病例一牙技师、不重复处理」的约束冲突 | 代码只按新约束实现（[ADR-0003](adr/0003-one-technician-per-case.md)）。H0 与 PR #4 的分析设计需要由项目负责人按新约束重新确定；本轮不修改研究设计文档 |
| R3 | PR #3 与 PR #4 的 Q13–Q18 编号冲突 | 只记录，不重新编号（[ADR-0007](adr/0007-question-numbering-conflict.md)） |
| R4 | 05 / 06 只在 PR #3 中 | 代码按 05 v0.2 与 06 v0.1 实现；二者合并或修订后需要复核 `contracts`、`engine` 与 `agent-tools` |
