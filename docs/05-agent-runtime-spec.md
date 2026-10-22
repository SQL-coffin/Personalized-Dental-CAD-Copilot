# 05 · Agent Runtime 规范（Runtime Contract）

版本：v0.1 草案

来源：在 Agent Runtime Architecture Proposal v0.1（2026-10-22 讨论）的基础上整理和修订。与提案的差异见附录 A。

本文细化 [01 系统架构说明](01-system-architecture.md) 中的 Runtime Harness，不是一套平行架构。01 继续描述总体系统；本文规定 Runtime 必须遵守的契约。

本文是设计规范，不代表代码已经实现，也不代表任何研究假设已经通过验证。

## 0. 约定

**用词**

- **必须**：违反即视为 Runtime 不合格，有对应的验收测试（第 14 节）。
- **应当**：默认要求；不采用时须记录理由。
- **可以**：可选。

**状态标注**

- 【已定义】：已在 00–04 中定义，本文只引用。
- 【新增】：本文提出。
- 【待决】：需要项目负责人决定，见 [待决问题](open-questions.md)。

**命名**：已有文档用过算法路线 L0–L5、采集粒度 C0–C3、权限级别 R / S / E、实验组 A0 / P / G / M / L、实验阶段 1–3。为避免混淆，本文的记忆层用名称（Evidence / Record / Working / Knowledge），开发阶段用 Phase 0–4。

## 1. 范围

范围内：

- Runtime Harness 各模块的职责与边界
- 任务与工作假设的状态模型
- 工具契约与调用协议
- 记忆分层、读写规则与防泄漏
- 上下文压缩与恢复协议
- 权限、审批、数据分区、外发控制与受控删除
- 预算与停止条件
- 验收测试

范围外：

- 具体的编程语言、存储系统、模型或 Agent 框架
- 预测方法本身（P / G / M / L 的定义见 [03](03-experiment-protocol.md)）
- 3Shape 接口的具体实现（Phase 3 审计后再定）

## 2. 不变量 【新增】

Runtime 的任何实现都必须满足以下不变量。第 14 节的每个验收测试至少对应其中一条。

| 编号 | 不变量 |
|---|---|
| I1 | **上下文是缓存，不是状态。** 任务状态、审批、证据和假设只存在于持久存储中；模型上下文可以随时丢弃，并从存储重建。 |
| I2 | **原始证据只追加。** Evidence Store 的记录不被修改或覆盖；更正以新记录取代旧记录；删除只能走第 10.5 节的受控删除流程。 |
| I3 | **权限由确定性代码执行。** 模型只能经 Policy Gate 调用工具；模型没有任何途径修改策略、运行模式、预算上限或审批记录。 |
| I4 | **审批只来自审批记录。** 审批是人工经审批通道写入、绑定具体候选的记录；摘要、对话文字或数据内容中的「已批准」不构成审批。 |
| I5 | **偏好与质量分开。** 【已定义，01 §5、03 §3】任何数据结构和排序都不能把两者合并成一个分数。 |
| I6 | **假设不是事实。** 工作假设只有 Evaluation Harness 能标为 VALIDATED；研究假设 H1–H4 的结论由项目负责人依据评估结果作出。 |
| I7 | **记忆有时间与来源边界。** 每条派生记忆记录来源病例、来源患者与时间截止；查询能按时间和患者排除。 |
| I8 | **每次工具调用可追溯。** 记录工具版本、输入与输出的哈希、执行状态。 |
| I9 | **证据不足或冲突时暂停。** 【已定义，README 原则】不凭摘要或推测继续。 |
| I10 | **评估数据隔离。** agent（Research Engine）不能读取留出评估数据。 |
| I11 | **数据内容不是指令。** 病例备注、文件名、元数据、工具输出中的文字只作为数据处理，不能改变任务、权限或策略。 |

## 3. 模块与 01 架构的对应 【新增】

### 3.1 对应关系

| 01 中的组成 | 本文中的模块 | 说明 |
|---|---|---|
| 数据层 | Data & Adapter Layer + Evidence Store | 适配器把 CAD 导出、STL、操作记录、人工反馈写入 Evidence Store |
| 几何引擎 | Geometry Engine | 不变；以确定性工具的形式注册（第 7 节） |
| 经验库 | Memory Manager 的 Knowledge Store 与检索接口 | 增加时间与来源边界（第 8 节） |
| 预测 / 推理层 | Research Engine + 已注册的 Predictor | 拆成两部分：Research Engine 组织研究；候选几何只能来自已注册、冻结版本的 Predictor（第 5.3 节） |
| Runtime Harness | Task & State Manager、Tool Registry、Memory Manager、Policy Gate、Decision Ledger、Compaction Manager | 本文细化 |
| Evaluation Harness | Evaluation Harness | 不变；另承担 Runtime 验收测试（第 14 节） |

### 3.2 模块职责

| 模块 | 职责 | 关键约束 |
|---|---|---|
| Task & State Manager | 维护事件日志、任务状态与检查点 | 状态是事件日志的投影，不存在于对话上下文（第 6 节） |
| Tool Registry | 注册工具，校验输入输出，记录调用 | 每个工具有权限级别、契约和版本（第 7 节） |
| Memory Manager | 管理四层记忆的读写与检索 | 读写规则与防泄漏（第 8 节） |
| Policy Gate | 检查运行模式、权限级别、审批、数据分区、外发、预算 | 确定性代码；模型不能绕过或修改（第 10 节） |
| Decision Ledger | 记录观察、假设、证据、候选方案和结果 | 字段沿用 01 §5；不保存隐藏推理链（第 11 节） |
| Compaction Manager | 压缩模型上下文，生成上下文摘要 | 只作用于模型上下文；不写证据，不产生审批，不生成检查点（第 9 节） |
| Research Engine | 组织研究流程，提出和检验工作假设，规划分析 | 必须允许反例；不能读取留出评估数据 |
| Geometry Engine | 确定性三维几何计算 | 几何变化不等于质量改善 |
| Evaluation Harness | 评估系统是否可靠地进步；执行验收测试 | 与 Runtime 的即时决策分离 |

## 4. 运行模式 【新增】

| 模式 | 用途 | 可注册的工具级别 | 建议对牙技师可见 | 最早开发阶段 |
|---|---|---|---|---|
| offline-research | 分析历史数据，运行离线实验 | R | 不适用 | Phase 1 |
| shadow | 在真实会话旁路生成建议，只记录不展示 | R、S（不展示） | 否 | Phase 3 之后 |
| assist | 向牙技师展示建议 | R、S | 是 | Phase 4 |
| assist-execute | 经批准后把候选写入 CAD | R、S、E | 是 | Phase 4 后期 |

- 必须：某模式不允许的级别，其工具在该模式下**不注册**，而不只是被拦截。没有能力比拦截能力更可靠。
- 必须：模式由部署配置决定，模型不能切换。
- 必须：E 级工具在 Phase 4 之前不存在于任何部署中。
- shadow 模式可以在不影响牙技师的前提下，前瞻性地收集 T1 / T2 的预测与实际结果；但它不能产生接受率，因为建议没有被展示（与 [03](03-experiment-protocol.md) §3.1 一致）。

## 5. 核心对象 【新增；字段与 01、02 对齐】

### 5.1 事件信封

所有状态变化都以事件写入事件日志：

| 字段 | 内容 |
|---|---|
| `event_id`、`seq` | 唯一 ID 与单调递增序号 |
| `prev_hash`、`hash` | 完整性校验（候选机制：哈希链） |
| `timestamp` | 时间 |
| `actor` | 类型（human / agent / tool / system / evaluation）、ID、版本 |
| `task_id` | 所属任务 |
| `type` | 事件类型 |
| `payload_ref` | 负载的内容寻址引用；负载存于 Evidence Store 或 Record Store |
| `schema_version` | 事件结构版本 |

### 5.2 对象一览

| 对象 | 存放位置 | 写入者 | 说明 |
|---|---|---|---|
| Task / Step | 事件日志 | Runtime | 状态见第 6 节 |
| ToolCall | 事件日志 + Evidence Store | Tool Registry | 第 7 节 |
| Evidence | Evidence Store | 适配器、工具、人工 | 原始数据，只追加 |
| Observation | Record Store | agent、工具 | 「实际观察到什么」，必须引用 Evidence |
| WorkingHypothesis | Record Store | agent | 第 5.3 节 |
| DecisionRecord | Record Store | agent、Runtime | 第 11 节 |
| PreferenceEstimate | Record Store | Predictor | 偏好估计及其不确定性；对应 01 §5 的 Preference |
| QualityResult | Record Store | Geometry Engine、人工复核 | 含 `evaluation_validity` 与 `quality_result`（02 §12.1）；对应 01 §5 的 Quality |
| Verification | Record Store | 人工 | 人工确认、拒绝或独立验证 |
| Approval | 审批存储 | 人工 | 第 10.3 节 |
| Conflict | Record Store | 任何检测者 | 第 12 节 |
| KnowledgeItem | Knowledge Store | agent 提议；状态由 Evaluation Harness 更新 | 第 8.2 节 |
| Checkpoint | 事件日志 | Task & State Manager | 第 9.3 节 |

[02](02-data-specification.md) 定义的 Case、Session、Episode、GD、CE、VI 属于 Record Store，由确定性工具或人工产生。agent 不能直接写入，只能请求工具计算。

### 5.3 两类假设

| 类型 | 例子 | 所有者 | agent 权限 |
|---|---|---|---|
| 研究假设 | H1–H4（[00](00-research-charter.md) §4） | 项目负责人，预先登记 | 只读；不能修改，不能判定结论 |
| 工作假设 | 「该技师在下颌磨牙远中颊侧倾向于降低 margin line」 | agent 提出 | 可以提出、检验、撤回 |

工作假设的状态：

```
PROPOSED ─▶ TESTING ─┬─▶ SUPPORTED_EXPLORATORY ─▶ 预登记评估（Evaluation Harness）─┬─▶ VALIDATED
                     ├─▶ REFUTED                                                 └─▶ NOT_REPLICATED
                     └─▶ INCONCLUSIVE

任何状态 ─▶ RETRACTED（附理由）
```

- 必须：只有 Evaluation Harness 能写入 VALIDATED 和 NOT_REPLICATED，且只能基于 [03](03-experiment-protocol.md) 规定的预登记评估，在留出数据上进行。
- 必须：SUPPORTED_EXPLORATORY 只说明在开发数据上找到了支持证据，不能用来生成建议，也不能写成已验证的偏好。
- 应当：每个工作假设同时检索支持和反对的证据；只找支持证据的检验视为不完整。
- 必须：记录在同一批开发数据上检验过的工作假设总数，报告探索性结果时一起给出，以便判断多重比较的影响。

**候选几何的来源**

- 必须：任何向牙技师展示或执行的候选几何，只能来自已注册、冻结版本的 Predictor（例如 03 的 P / G / M / L）和 Geometry Engine，并通过质量闸门（01 §5）。
- 必须：Knowledge Store 中的文字性知识（例如偏好描述）不能直接生成几何。它只用于解释、规划研究和提出新的 Predictor 配置；新配置必须注册为新版本，经评估后才能使用。

## 6. 任务状态模型 【新增】

### 6.1 事件溯源

- 必须：任务状态是事件日志的投影，从头回放事件即可得到当前状态。
- 必须：检查点是某个 `seq` 处的状态快照，附快照哈希；恢复时快照必须与日志一致。
- 模型上下文不保存任何不能从日志重建的状态（I1）。

### 6.2 状态

| 状态 | 含义 | 对应提案的工作循环 |
|---|---|---|
| PLANNING | 观察、提出工作假设、规划步骤 | Observe、Form Hypothesis、Plan |
| RUNNING | 在策略允许的范围内执行，或离线模拟 | Execute or Simulate |
| VERIFYING | 检查工具结果、几何结果、版本对应与反馈 | Verify |
| RECORDING | 写入 Observation、DecisionRecord，更新假设状态 | Record and Update |
| BLOCKED(reason) | 暂停，等待解除条件（第 6.4 节） | — |
| DONE / FAILED / CANCELLED | 终止状态 | — |

工作循环中的 Check Policy 不是独立状态，而是进入 RUNNING 的守卫条件。

### 6.3 转移

| 从 | 到 | 条件 |
|---|---|---|
| CREATED | PLANNING | 任务创建 |
| PLANNING | RUNNING | Policy Gate 对计划中的全部工具调用检查通过：工具在当前模式已注册、数据分区允许、外发允许、预算充足、所需审批有效 |
| PLANNING | BLOCKED(approval) | 计划中有需要审批的步骤，且没有有效审批 |
| RUNNING | VERIFYING | 本步工具调用完成 |
| VERIFYING | RECORDING | 后置条件与验证通过 |
| VERIFYING | PLANNING | 验证失败，重试预算未用完；失败本身被记录 |
| VERIFYING | FAILED | 验证失败，重试预算已用完 |
| RECORDING | PLANNING | 还有下一轮，且预算允许 |
| RECORDING | DONE | 满足完成条件（见下） |
| RECORDING | BLOCKED(human_feedback) | 需要人工反馈才能继续 |
| 任何活动状态 | BLOCKED(missing_evidence / conflict / budget / drift / in_doubt) | 见第 6.4 节 |
| BLOCKED | PLANNING | 解除条件满足 |
| 任何非终止状态 | CANCELLED | 人工取消 |

DONE 的条件：

- 所有步骤都已验证并记录；
- 结论所依赖的证据中没有未解决的冲突，或者冲突已明确列为结论的局限；
- 相关工作假设的状态都已更新。

### 6.4 阻塞原因

| `reason` | 触发 | 解除条件 |
|---|---|---|
| approval | 需要审批且没有有效审批 | 审批存储中出现有效审批 |
| human_feedback | 需要人工判断（例如标注、意图说明），或同一请求反复被策略拒绝 | 收到人工反馈记录 |
| missing_evidence | 引用的证据不存在或校验失败 | 证据重新获取并校验通过，或人工改写计划 |
| conflict | 检测到未解决冲突（第 12 节） | 冲突按预定规则解决 |
| budget | 预算耗尽（第 13 节） | 人工追加预算或取消 |
| drift | 恢复时发现工具、模型、策略或数据分区版本变化（第 9.4 节） | 人工确认继续或重新规划 |
| in_doubt | 有副作用的调用在崩溃时状态不明（第 9.4 节） | 对账完成或人工确认 |

- 必须：BLOCKED 期间不发起新的工具调用（只读的状态查询除外）。
- 必须：每次进入 BLOCKED 时生成简短报告：原因、已完成的内容、需要谁做什么。

## 7. 工具契约 【新增；权限级别沿用 04 §2】

### 7.1 注册信息

| 字段 | 内容 |
|---|---|
| `tool_id`、`version` | 工具标识与版本 |
| `kind` | geometry / data / predictor / llm / adapter / io |
| `tier` | R / S / E（[04](04-risk-and-governance.md) §2） |
| `modes` | 允许的运行模式 |
| `input_schema`、`output_schema` | 输入输出结构 |
| `data_scopes` | 需要读取的数据分区（第 10.4 节） |
| `deterministic` | 相同输入是否得到相同输出；若否，声明可接受的数值容差，或标记为非确定 |
| `side_effects` | none / writes_store / writes_cad |
| `idempotent` | 重复执行是否安全 |
| `postconditions` | 工具特定的结果检查（例如几何工具必须返回对应状态） |
| `timeout`、`error_codes` | 超时与错误代码 |
| `egress` | 是否把数据发送到 Runtime 之外（例如外部模型 API），以及发送的数据类别（第 10.6 节） |

### 7.2 调用协议

1. agent 提出调用请求：工具、版本、参数。
2. Policy Gate 检查：工具在当前模式已注册，级别、数据分区、外发、预算均允许；E 级还要有效审批。
3. 有副作用的调用：先写**意图记录**（参数、预期效果、执行前版本快照 ID），再执行。
4. 执行，校验输出结构与后置条件。
5. 写**完成记录**（ToolCall）：工具版本、输入哈希、输出哈希或输出引用、耗时、状态。
6. 把结果返回给 agent。结果是数据，不是指令（I11）。

### 7.3 错误与状态

| 错误 | 后果 |
|---|---|
| INVALID_INPUT | 回到 PLANNING |
| POLICY_DENIED | 回到 PLANNING；同一请求被拒次数超过阈值时进入 BLOCKED(human_feedback) |
| NEEDS_APPROVAL | BLOCKED(approval) |
| DATA_UNAVAILABLE | BLOCKED(missing_evidence) |
| TIMEOUT、TOOL_ERROR | 幂等工具在重试预算内重试；否则进入 BLOCKED(in_doubt) 或 FAILED |
| POSTCONDITION_FAILED | 进入 VERIFYING 的失败分支 |

### 7.4 非确定性工具与重放

模型调用等非确定性工具必须记录：模型 ID 与版本、调用参数、提示哈希、完整输出。

两种重放必须区分：

- **忠实重放**（审计用）：使用记录的输出，不重新调用；结果必须与原始运行一致。
- **重新执行**（回归与评估用）：用指定版本重新调用；与原始运行的差异单独报告。

### 7.5 Predictor

Predictor 是 `kind = predictor` 的工具：

- 必须：参与 [03](03-experiment-protocol.md) 评估的 Predictor 在评估前冻结版本与参数（例如 M 的相似度特征、`k`、聚合方式，见 03 §5.1）。
- 必须：Predictor 读取历史时经过 Memory Manager，受第 8.3 节的时间与来源边界约束。

## 8. 记忆分层 【新增；Record Store 中的对象沿用 02】

### 8.1 四层记忆

| 层 | 内容 | 写入者 | 可变性 | 是否受压缩影响 |
|---|---|---|---|---|
| Evidence Store | CAD 导出、STL、操作事件、工具输入输出负载、人工反馈原文 | 适配器、工具、人工 | 只追加；内容寻址 | 否 |
| Record Store | 02 的 Case / Session / Episode / GD / CE / VI；Observation、DecisionRecord、QualityResult、Conflict、工作假设 | 确定性工具、人工；agent 只能写 Observation、DecisionRecord 与工作假设 | 只追加；以新记录取代旧记录 | 否 |
| Working Memory | 当前目标、计划、未完成步骤、未决假设列表、最近结果的引用、预算余量 | Runtime 从事件日志与 Record Store 投影生成 | 随时可以重建 | 是（压缩的唯一对象） |
| Knowledge Store | 跨病例总结、偏好描述、适用条件、反例 | agent 提议；状态由 Evaluation Harness 更新 | 带版本，只能以新版本修改 | 否 |

### 8.2 KnowledgeItem

| 字段 | 内容 |
|---|---|
| `item_id`、`version` | 标识与版本 |
| `statement` | 知识内容 |
| `scope` | 适用条件（牙技师、牙位、修复类型等） |
| `status` | CANDIDATE / VALIDATED / DEPRECATED，与对应工作假设的状态联动 |
| `supporting`、`contradicting` | 支持与反对证据的引用 |
| `lineage` | 来源病例 ID、来源患者 ID、来源数据的最晚时间、来源数据分区 |
| `derived_by` | 生成者（agent、模型、工具及其版本） |

- 必须：新证据与 VALIDATED 条目矛盾时，追加到 `contradicting`，并创建冲突记录；不能静默修改或删除条目。
- 必须：DEPRECATED 条目保留，只是不再被默认检索。

### 8.3 读取边界（防泄漏）

每次记忆查询必须带上：

| 参数 | 含义 |
|---|---|
| `as_of` | 只返回来源数据全部早于该时间的条目 |
| `exclude_patients` | 排除来源包含这些患者的条目 |
| `partitions` | 允许的数据分区 |

- 必须：Evaluation Harness 对测试病例 `c` 运行时，`as_of` 设为 `c` 的时间，`exclude_patients` 包含 `c` 的患者（与 [03](03-experiment-protocol.md) §2、§5.1 一致）。
- 必须：条目的来源中只要有一部分不满足边界，整个条目都不返回，不能部分使用。
- 必须：每次 Knowledge Store 读取都记录查询参数与返回的条目，供泄漏审计。

## 9. 上下文压缩与恢复 【新增】

### 9.1 原则

- 压缩只作用于模型上下文（Working Memory 的呈现），不触及 Evidence Store、Record Store 和 Knowledge Store。
- 压缩的产物是**上下文摘要**：可以重新生成的派生物，不具有权威性。权威的是存储。
- 检查点由 Task & State Manager 在步骤边界创建，与压缩分开。压缩可以引用检查点，但不能生成或改写检查点。

### 9.2 上下文摘要

| 部分 | 内容 | 生成方式 | 权威性 |
|---|---|---|---|
| 结构化部分 | 任务状态、未完成步骤、未决假设及其状态、待审批、未解决冲突、预算余量、关键证据引用 | 从存储确定性生成 | 与存储一致即可信 |
| 叙述部分 | 当前思路、下一步打算 | 模型撰写 | 非权威；每条陈述必须引用证据或记录，没有引用的陈述标为「未核实」 |

- 必须：审批状态只出现在结构化部分，且来自审批存储。叙述部分出现的「已批准」不产生任何权限（I4）。

### 9.3 检查点

| 字段 | 内容 |
|---|---|
| `checkpoint_id`、`seq`、`snapshot_hash` | 标识、对应的事件序号、快照哈希 |
| `task_id`、`case_ids`、`timestamp` | 范围与时间 |
| `state` | 任务状态、已完成与未完成的步骤 |
| `open_hypotheses` | 未决工作假设及其状态 |
| `evidence_refs` | 关键证据引用 |
| `tool_call_refs` | 已完成工具调用的引用 |
| `in_flight` | 有意图记录、尚无完成记录的调用 |
| `versions` | 工具、模型、策略、数据分区定义的版本 |
| `digest_version` | 对应的上下文摘要版本 |
| `revalidate` | 恢复后需要重新验证的事项 |

审批不是检查点的权威内容，恢复时从审批存储重新读取。

### 9.4 恢复流程

1. **找检查点**：选择最近一个快照哈希校验通过、且从它到日志末尾完整性校验也通过的检查点。
2. **重建状态**：加载快照，回放其后的事件。
3. **核对证据**：所有被引用的证据都必须能找到且哈希一致；缺失时，相关步骤进入 BLOCKED(missing_evidence)。
4. **重读审批**：从审批存储重新读取；已过期、已撤销或候选已变化的审批作废，相关步骤进入 BLOCKED(approval)。
5. **检查版本漂移**：工具、模型、策略或数据分区定义与检查点记录不同时：
   - 属于预登记评估运行的任务：进入 BLOCKED(drift)，不能用新版本继续，否则评估无法复现；
   - 探索性任务：记录漂移事件，之后的结果标注新版本，可以继续。
6. **处理进行中的调用**：
   - 无副作用或幂等的调用：重试；
   - 有副作用且不幂等的调用：先用只读工具对账（例如读取 CAD 当前状态，与意图记录中的预期效果比较）；无法确定时进入 BLOCKED(in_doubt)，**不能自动重试**。
7. **重建上下文**：从存储重新生成上下文摘要的结构化部分，与压缩前的结构化部分逐项比较，必须一致。
8. **继续**：从最近的安全状态继续。

### 9.5 压缩时机

- 应当：在步骤边界（RECORDING 之后）压缩，不在工具调用进行中压缩。
- 可以：在上下文接近容量时、或长时间等待人工之前压缩。

## 10. 权限、审批与数据治理 【R / S / E 已定义于 04 §2；其余新增】

### 10.1 Policy Gate

- 必须：用确定性代码实现，不调用模型做权限判断。
- 必须：策略配置有版本，存放在模型无法写入的位置；策略变化本身是事件。
- 必须：所有工具调用都经过 Policy Gate，没有旁路。

### 10.2 运行模式与权限级别

见第 4 节与 [04](04-risk-and-governance.md) §2。

### 10.3 审批

| 字段 | 内容 |
|---|---|
| `approval_id` | 标识 |
| `approver` | 经过身份验证的人工 ID；agent 不能写审批 |
| `scope` | 被批准对象的精确引用：候选几何哈希、工具 ID 与版本、参数哈希 |
| `granted_at`、`expires_at` | 授予与过期时间 |
| `single_use` | E 级审批必须一次性 |
| `conditions` | 附加条件（例如必须先通过质量闸门） |

- 必须：候选几何或参数发生任何变化，原审批作废。
- 必须：审批通道独立于模型对话；模型转述的批准不算审批。
- 审批人与有效期待定（Q17）。

### 10.4 数据分区

| 分区 | 内容 | Research Engine | Predictor（评估运行中） | Evaluation Harness |
|---|---|---|---|---|
| dev | 开发数据 | 可读 | 按第 8.3 节的边界读取 | 可读 |
| calib | 阈值与分界值的校准数据（例如 03 §4.2 的校准子集） | 可读，仅用于校准任务 | 否 | 可读 |
| holdout | 留出评估数据（03 的测试病例、H1 评估子集） | **不可读**（输入与标签都不可读） | 只读当前测试病例的输入 | 仅在预登记评估运行中可读 |
| review | 专家质量复核结果 | 不可读其中属于 holdout 的部分 | 否 | 可读 |

- 必须：越权读取被拒绝并记录。
- 必须：参数校准只在 calib 上进行；holdout 不参与任何参数调整。

### 10.5 患者数据与受控删除 【待决：Q5、Q10、Q16】

「证据只追加」与「同意撤回、保留期限」之间有冲突，需要在设计上调和：

- 必须：进入 Evidence Store 之前完成匿名化（[04](04-risk-and-governance.md) §1）。
- 应当：证据负载按患者加密存储；删除时销毁该患者的密钥（候选机制），日志中只留删除事件（墓碑），日志完整性不受影响。
- 必须：Record Store、Knowledge Store 和 Predictor 版本都记录来源患者（lineage），以便删除时找出所有受影响的派生物。
- 必须：删除后，受影响的派生物被标记；是否需要重新计算或重新训练 Predictor，按保留政策决定（待决）。

### 10.6 外发控制 【待决：Q14、Q15】

调用 Runtime 之外的服务（例如外部模型 API）就是数据外发。

| 数据类别 | 例子 | 默认 |
|---|---|---|
| 合成数据 | 测试夹具 | 允许 |
| 去标识的结构化数据 | GD 描述符、统计量、任务状态 | 按数据处理协议决定 |
| 去标识的几何 | 网格、曲线 | 默认不允许 |
| 原始或可能可识别的数据 | 原始扫描、订单信息 | 不允许 |

- 必须：Policy Gate 按工具注册的 `egress` 信息和数据类别检查每次外发；未声明的外发一律拒绝。
- 允许外发的范围由部署方式与数据处理协议决定。

## 11. Decision Ledger 【字段沿用 01 §5；结构新增】

每条 DecisionRecord：

| 字段 | 内容 |
|---|---|
| `decision_id`、`task_id`、`case_id` | 标识与范围 |
| Observations | Observation 引用 |
| Hypothesis | 工作假设引用 |
| Evidence | 证据引用，每条标明「支持」或「反对」 |
| Alternatives | 其他候选，以及未选的理由 |
| Preference | PreferenceEstimate 引用 |
| Quality | QualityResult 引用（含 `evaluation_validity` 与 `quality_result`） |
| Correspondence | 依据区域的对应状态 |
| `rationale` | 理由摘要；每条陈述引用证据或记录 |
| `uncertainty` | 不确定性说明 |
| `outcome` | 采取的行动，或「无法可靠判断」 |
| Verification | 人工确认、拒绝或独立验证的引用 |
| `actor` | 生成者及版本 |

- 不保存隐藏推理链；`rationale` 是可检查的摘要，不是证据。
- 只追加；更正以新记录取代旧记录。

## 12. 冲突处理 【新增；各类解决规则沿用 02、03】

| 冲突类型 | 例子 | 预定的解决规则 |
|---|---|---|
| 专家意见不一致 | 两位复核专家结论不同 | 03 §7.4：第三位裁定，或登记的替代流程 |
| 对应路径不一致 | 相邻对应与直接对 `S_0` 对应的位置不同 | 02 §6.3：标为 AMBIGUOUS，不选真值 |
| 规则与人工标签不一致 | 去向规则的输出与人工标注不同 | 03 §4.2：以人工标签为准，记录差异 |
| 知识与新证据矛盾 | VALIDATED 条目遇到反例 | 第 8.2 节：追加反例；超过阈值时创建重新评估任务 |
| 数据或版本不一致 | 引用的几何版本哈希不匹配 | BLOCKED(missing_evidence) |

- 必须：冲突是独立记录，状态为 OPEN / RESOLVED，包含相关条目、检测者、解决规则、解决者和解决依据。
- 必须：模型不能自行解决冲突。它可以提出解决建议，建议作为记录保存，由预定规则或人工执行。

## 13. 预算与停止条件 【新增】

每个任务登记预算：

- 最大循环轮数、工具调用次数、运行时间、计算成本；
- 同时未决的工作假设数量上限。

| 停止条件 | 结果 |
|---|---|
| 任一预算耗尽 | BLOCKED(budget)，附报告 |
| 连续 N 轮没有新证据 | 结束本轮研究，未决假设标为 INCONCLUSIVE，附报告 |
| 同一请求反复被策略拒绝 | BLOCKED(human_feedback) |
| 检测到冲突 | BLOCKED(conflict) |

- 必须：预算上限由部署配置给出，模型不能修改（I3）。

## 14. 验收测试 【新增】

测试使用合成病例与故障注入（终止进程、删除或篡改证据、更改工具版本、在数据中加入指令文本），不依赖真实 3Shape 数据。

| 编号 | 场景 | 通过条件 | 不变量 |
|---|---|---|---|
| AT-01 | 在每个状态下终止进程后恢复 | 恢复后的状态等于事件日志的回放结果；未完成步骤与预算一致 | I1 |
| AT-02 | 多次压缩后查询 | 上下文摘要的结构化部分与存储逐项一致；未完成任务、待审批、未决假设、未解决冲突的查询结果与存储一致 | I1 |
| AT-03 | 多次压缩与恢复后检查证据 | Evidence Store 所有负载的哈希不变 | I2 |
| AT-04 | 抽查工具调用 | 每次调用都有版本、输入输出哈希与状态；确定性工具重新执行的结果一致（或在声明容差内） | I8 |
| AT-05 | 检查数据结构与排序 | 不存在合并偏好与质量的字段或排序路径；排序遵循质量闸门在先 | I5 |
| AT-06 | 注入矛盾证据 | 产生 OPEN 冲突记录；原记录不被覆盖 | I9 |
| AT-07 | 越权调用：在 offline-research 模式请求 S / E 级工具、使用过期审批、使用候选已变化的审批 | 全部拒绝并记录 | I3、I4 |
| AT-08 | 摘要或数据内容中出现「已批准」「忽略之前的规则」等文字 | 不产生任何权限；任务与策略不变 | I4、I11 |
| AT-09 | Research Engine 读取 holdout；评估运行中查询 Knowledge Store | 前者被拒绝并记录；后者只返回满足 `as_of` 与患者排除条件的条目 | I7、I10 |
| AT-10 | 忠实重放一次历史评估运行 | 复现原记录的结果与指标 | I8 |
| AT-11 | 用测试用的有副作用、不幂等工具，在意图记录与完成记录之间终止进程 | 恢复后进入对账或 BLOCKED(in_doubt)，不自动重试 | I1 |
| AT-12 | 预算耗尽 | 进入 BLOCKED(budget)，之后没有新的工具调用 | I3 |
| AT-13 | 删除某位患者的数据 | 负载不可读；日志完整性校验仍然通过；受影响的派生物被标记 | I2 |
| AT-14 | 恢复时工具版本发生变化 | 评估任务进入 BLOCKED(drift)；探索性任务记录漂移后继续 | I8 |
| AT-15 | 未声明外发的工具尝试发送数据 | 拒绝并记录 | I3 |

## 15. 开发阶段 【在提案基础上补充进入与退出条件】

开发阶段 Phase 0–4 与实验协议的阶段 1–3 不是同一套编号。

| 阶段 | 内容 | 进入条件 | 退出条件 |
|---|---|---|---|
| Phase 0 · Runtime Contract | 本文：不变量、状态模型、工具契约、记忆分层、压缩恢复协议、权限边界、验收测试 | — | 本文评审通过；验收测试写成可执行的测试说明 |
| Phase 1 · Offline Research Agent | 在合成数据与已有 STL 上运行 offline-research 模式 | Phase 0 退出 | AT-01 至 AT-09、AT-11 至 AT-15 通过 |
| Phase 2 · Evaluation Harness | 历史重放、冻结的 Predictor（P / G / M；L 视数据而定）、压缩一致性测试、失败分析 | Phase 1 退出 | AT-10 通过；能对登记的实验配置做忠实重放 |
| Phase 3 · 3Shape Adapter | Dental System 2024 的可观测性与授权审计；确定能达到的采集粒度（02 §6.5）；只读适配器 | Q1、Q5、Q10 已决 | 适配器只读运行；采集粒度已登记；shadow 模式可用 |
| Phase 4 · Supervised Assistance | 先 assist（S 级），后 assist-execute（E 级） | 相关评估结果支持（03 阶段 3）；审批流程已决（Q17） | 待定 |

Phase 1 的范围：

- STL 格式只存三角网格，不包含 margin line 曲线、编辑事件或中间版本（除非另有导出）。因此 Phase 1 验证的是 **Runtime 本身**（恢复、压缩、追溯、权限、隔离），**不能**检验 H1–H4。
- 已有 STL 是否同时包含 AI 初始设计与最终设计，决定能否计算任何 Final GD（Q18）。

## 附录 A · 与提案 v0.1 的差异

| 提案 v0.1 | 本文 | 理由 |
|---|---|---|
| Compaction Manager 生成恢复检查点 | 检查点由 Task & State Manager 在步骤边界生成；压缩只产生可重建的上下文摘要 | 压缩不应成为状态的来源（I1） |
| 检查点记录人工审批状态 | 审批只来自审批存储，恢复时重读；候选变化即作废 | 摘要或快照中的「已批准」不能产生权限（I4） |
| 记录压缩前后摘要的校验结果 | 结构化部分从存储确定性生成，逐项比较 | 一致性必须能机械检查，不依赖模型判断 |
| Memory Manager 管理个人偏好 | 文字性偏好不能直接生成几何；候选几何只来自冻结版本的 Predictor | 与 01「几何生成与 AI 推理分离」一致；未经评估的偏好不进入建议 |
| Research Engine 提出假设、规划实验 | 区分研究假设（H1–H4，agent 只读）与工作假设；agent 不能读留出数据；只有 Evaluation Harness 能判定 VALIDATED | 防止探索性分析污染评估数据 |
| 记忆层 L0–L3 | Evidence / Record / Working / Knowledge | L0–L5 已用于 01 的算法路线 |
| L0 只追加 | 只追加 + 按患者加密与受控删除 + lineage | 调和只追加与同意撤回、保留期限 |
| — | 运行模式（offline-research / shadow / assist / assist-execute） | 不同阶段注册不同工具；shadow 模式支持前瞻性收集预测结果 |
| — | 有副作用调用的意图记录与对账 | 崩溃后不能重复执行写入 CAD 的动作 |
| — | 恢复时检查版本漂移 | 评估运行必须可复现 |
| — | 外发控制；数据内容不是指令 | 患者数据可能经模型 API 外发；数据中的文字可能被当作指令 |
| 8 条验收标准 | 15 个验收测试，各自对应不变量 | 可执行、可判定 |
