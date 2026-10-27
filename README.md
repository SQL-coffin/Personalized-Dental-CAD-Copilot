# Personalized Dental CAD Copilot

个性化牙科 CAD 智能系统（暂定名：Personalized Dental CAD Intelligence）。

> 当前阶段：**研究设计与前端原型并行推进**。
>
> - 研究设计仍在审查中，正式实验尚未开始。
> - 代码是一个可运行的结构骨架：前端原型 + 在进程内运行的模拟 Runtime + 合成数据。
> - 它不连接任何 CAD 软件，不调用任何模型，不训练任何模型，也不绑定具体的 AI 模型或牙科 CAD 软件。
> - 完成骨架不代表任何研究假设得到验证，也不代表任何临床效果。

## 核心假设

如果系统能够记录牙技师面对初始设计时的修改行为，并将这些行为与三维几何变化、任务上下文和最终确认结果联系起来，那么它就可能逐渐学习到个人的设计偏好和修正策略，从而减少未来相似病例的人工调整时间。

这是一个**需要通过实验验证的假设**，不是已经成立的结论。

## 设计文件

| 编号 | 文件 | 内容 | 状态 |
|---|---|---|---|
| 00 | [研究章程](docs/00-research-charter.md) | 目标、非目标、假设、研究问题、成功标准 | v0.3 草案 |
| 01 | [系统架构说明](docs/01-system-architecture.md) | 双 harness、各层职责边界、决策记录、推荐规则 | v0.2 草案 |
| 02 | [数据规范](docs/02-data-specification.md) | GD / CE / VI，动作—版本—区域数据链，采集粒度，曲线对应，局部坐标系，质量证据 | v0.4 草案 |
| 03 | [实验协议](docs/03-experiment-protocol.md) | 假设—对照—终点映射、H1 消融、先验 / 检索 / 学习基线、样本量、Quality Validation 流程 | v0.3 草案 |
| 04 | [风险与治理规范](docs/04-risk-and-governance.md) | 患者数据、动作权限分级、人工审批、撤销、审计 | v0.2 框架 |
| 05 | Agent Runtime 规范（`docs/05-agent-runtime-spec.md`） | 运行模式、任务与步骤状态机、工具协议、审批、质量闸门、外发控制 | v0.2，**只在 PR #3 中，尚未合并** |
| 06 | Research Browser 接口（`docs/06-research-browser-mcp.md`） | 公开网页检索的端口与边界 | v0.1，**只在 PR #3 中，尚未合并** |
| — | [架构总览（代码结构）](docs/architecture/README.md) | 模块职责、依赖方向、端到端数据流、实现状态；[ADR](docs/architecture/adr/README.md)；[扩展点与未完成项](docs/architecture/extension-points.md) | v0.1 |
| — | [待决问题](docs/open-questions.md) | 需要项目负责人决定的事项 | 持续更新 |

## 当前优先级

不继续扩展算法路线，也不急着写模型。按第一轮研究设计审查的排序推进：

| 顺序 | 工作 | 主要文件 | 状态 |
|---|---|---|---|
| 01 | 修正实验映射：H1–H4 与对照组、主要终点、成功标准一一对应 | 00、03 | 已写入设计，待审 |
| 02 | 固定数据关联规则：动作、中间版本、CE、区域级 GD 与最终状态的关联 | 02 | 已写入设计，待审 |
| 03 | 验证几何假设：局部坐标系、法向位移、曲线对应与参数扰动 | 02、03 | 已写入设计；需先导数据验证 |
| 04 | 确定正式实验规模：先导后估算阶段 2、3 的样本量、阈值和质量评价流程 | 03 | 依赖先导数据 |

正式实验前还必须完成：

- 数据来源与合作方授权；
- 适用的数据保护法规；
- 2025 年 margin line 研究的完整引用（见[待决问题](docs/open-questions.md)）。

已确定的病例分配约束（[ADR-0003](docs/architecture/adr/0003-one-technician-per-case.md)）：

- 每个病例只分配给一位牙技师；
- 不同牙技师不处理同一病例，同一牙技师也不重复处理同一病例；
- 不默认采用重复分配或拉丁方设计。

每位牙技师的病例数量仍待确认。未合并的 PR #4 采用的标准病例设计与这一约束冲突，需要项目负责人处理。PR #3 与 PR #4 的 Q13–Q18 编号冲突也已记录，暂不重新编号（[ADR-0007](docs/architecture/adr/0007-question-numbering-conflict.md)）。

## 原则

- 设计先于代码：代码实现已经明确的设计，而不是由零散代码决定项目方向。
- 「改变发生了」不等于「改变是正确的」；个人偏好不等于设计质量。
- 病例之间的差异不能直接解释为个人偏好。
- 推理必须可验证：保留可检查的证据、候选方案、工具调用记录和验证结果，而不是依赖模型的自我解释。
- 几何计算与 AI 推理分离：三维几何由确定性算法计算和验证。
- 证据不足时，系统应输出「无法可靠判断」。
- 模拟就标明是模拟：未实现的部分以占位形式明确失败，不假装已经连接。

## 代码结构

```
packages/
  contracts/      跨层共享的类型与端口（UI ↔ Runtime、错误、事件、候选、审批）
  data/           Data Layer：02 数据模型与写入约束、合成数据集
  agent-tools/    Agent-Tool Layer：工具定义与目录、Agent 接口、外部系统端口
  research/       Research Layer：登记草案、基线（P / M / G）、T1/T2 指标、按患者划分、设计诊断
  runtime/        Runtime：engine（状态机、Policy Gate、步骤执行）· host（UI 端口）· simulation（模拟环境）
  integrations/   Integration Layer：HTTP/SSE 传输、真实 CAD、Research-Browser-MCP、模型提供方（均为占位）
apps/
  web/            前端：src/ui 产品界面（只依赖 contracts）· src/app 组装层
scripts/
  check-boundaries.mjs   模块依赖方向检查
```

当前能完整运行的流程：

1. 牙技师选择分配给自己的病例，用自然语言描述任务；
2. Runtime 由脚本 agent 写计划，逐步经 Policy Gate 调用模拟工具，得到候选、质量闸门结果和偏好估计；
3. 通过闸门的候选进入审批；批准后，经执行前版本核对，条件写入合成 CAD；
4. 数据层记录带审批的 Copilot 版本；
5. 每一步都产生事件，界面实时显示任务、计划、审批、病例记录与诊断。

九个模拟场景（故障计划）覆盖：

- 闸门未通过、区域对应不明确；
- 工具重试、写入结果不明；
- 审批期间设计被修改；
- 证据缺失、预算耗尽；
- 研究模式的人工验证。

各部分的实现状态（真实代码 / 模拟 / 占位）见[架构总览](docs/architecture/README.md)第 4 节。

```bash
npm ci
npm run dev        # 前端 + 进程内模拟 Runtime
npm run check      # 模块边界 + 类型检查 + 全部测试
npm run build      # 前端生产构建
```

前端原型的说明见 [`apps/web/README.md`](apps/web/README.md)。
