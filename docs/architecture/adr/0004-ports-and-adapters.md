# ADR-0004 · 外部系统一律经端口与可替换适配器接入；Research-Browser-MCP 保持独立仓库

- 状态：已采纳（2026-10-27）
- 相关：`packages/agent-tools/src/ports`，`packages/integrations`，`packages/runtime/src/simulation`，扩展点 X1–X4

## 背景

真实 Runtime 服务、牙科 CAD、Research-Browser-MCP、模型提供方，目前都还不能接入：

- CAD 的接口能力要等 Phase 3a 审计；
- 远程 Research Browser 默认关闭；
- 模型选择与允许外发的数据类别待决。

即便如此，结构不能因为这些未知而停下来，也不能让未实现的部分看起来像已经实现。Research-Browser-MCP 是独立仓库，本仓库只消费它。

## 决定

1. **端口**由消费方定义：
   - `CadPort`、`ModelProvider`、`ResearchBrowserPort` 放在 `agent-tools/src/ports`，失败统一为 `AdapterError(adapterId, code, message, outcome)`；
   - UI 端口放在 `contracts/src/ports.ts`。
2. 每个端口有三类实现：

   | 实现 | 位置 | 行为 |
   |---|---|---|
   | 模拟 | `runtime/src/simulation` | 可运行 |
   | 占位 | `packages/integrations` | 调用即以 `NOT_IMPLEMENTED` 或 `NOT_CONFIGURED` 失败，不发出任何外部请求 |
   | 真实 | 以后放在 `packages/integrations` | — |

3. 适配器自己声明能力，CAD 声明 `readDesign`、`versionQuery`、`conditionalWrite`、`editEvents`、`maxCaptureLevel`。未经审计的能力一律为 `unknown`。
4. 部署信息列出每个边界背后的实现（`IntegrationStatus.implementation`：simulated / placeholder / connected），界面逐项显示。
5. **Research-Browser-MCP**：
   - 只经 `ResearchBrowserPort` 消费，不复制或合并服务端代码；
   - 端口方法与 MCP 工具名的对应记录在 `RESEARCH_BROWSER_MCP_TOOLS`，需要与服务端仓库核对；
   - MCP 只是传输方式，权限仍由 Runtime 的 Policy Gate 决定：研究工具只在 offline-research 模式注册，外发类别为 `public_query`。
6. 新增的错误码：`NOT_IMPLEMENTED`（边界存在、实现不存在）和 `NOT_CONFIGURED`（实现存在、未配置端点、凭据或 provider）。所有层的错误都归一为 `ErrorInfo`，界面显示错误码，只对可重试的错误提供重试。

## 后果

- 接入真实系统时只新增适配器并在组装层替换。engine、Policy Gate 和 UI 不变。
- 占位失败得很明显，不会被误认为已连接。
- 模拟工具目前绑定 `SyntheticCadAdapter` 类型；接入真实 CAD 时要泛化为 `CadPort`（扩展点 X2）。

## 何时重新审视

- 某个外部系统的接口实际确定之后（例如 CAD 审计完成，或 MCP 工具列表与服务端核对之后）；
- 需要跨进程的端口（X1）时。
