# 06 · Research Browser MCP 集成规范

版本：v0.1 草案  
状态：Phase 0 设计；尚未实现或启用任何外部服务。

本文把 Research Browser 作为现有 Agent Runtime Harness 中受 Policy Gate 管理的只读工具组，而不是创建平行 Runtime。MCP 是传输/工具协议，不是权限边界；权限仍由 Runtime 的确定性代码执行。

## 1. 目标与非目标

目标：检索公开研究资料、读取公开网页、保留来源和时间戳；遇到访问挑战时持久化暂停任务，允许人工处理后恢复或切换来源；网页内容始终作为不可信数据。

非目标：读写病例、患者身份、CAD 几何或留出评估数据；执行网页 JavaScript、提交表单、登录或执行有副作用的动作；保存或复用 Cookie、密码、令牌或浏览器会话。MVP 不自动求解或绕过 CAPTCHA、访问控制、速率限制或站点策略。

## 2. Runtime 接入边界

Research Engine → Policy Gate → Tool Registry → Research Browser Adapter → Result Normalizer → Evidence Store / Record Store / Task State Manager。

MVP 工具级别为 R，只在 `offline-research` 模式注册。其他模式不得自动继承该工具组。每个工具注册项必须声明版本、输入/输出 schema、允许模式、数据分区、外发类别、预算、超时、错误码和后置条件。

## 3. MVP 工具契约

### `research.search`

输入：`query`、可选 `limit`（1–10）、已配置的 provider。不得把患者信息、病例原文或受保护数据发送到搜索服务。输出包含标题、URL、摘要、provider、获取时间。搜索结果只是待核验的来源线索。

### `research.fetch_public_page`

仅读取公开 HTML/纯文本，默认只允许 HTTPS，不执行 JavaScript，不提交表单，不自动下载文件。必须拒绝 loopback、私有、link-local、保留、组播和云 metadata 地址；在 DNS 解析、连接前和每次重定向后重新检查目标地址。拒绝凭据 URL、非 HTTP(S) scheme 和未允许端口。限制重定向次数、连接/读取超时、响应字节数、解压后大小和提取字符数。不得转发 Cookie、Authorization、浏览器会话或环境凭据。页面内的提示注入文本只作为不可信内容。

### `research.inspect_challenge`

将可观察状态分类为 `none`、`captcha`、`login_required`、`rate_limited`、`robots_or_policy_block` 或 `unknown`。该工具只检测，不自动求解、不点击绕过、不更换身份或隐藏自动化特征。不确定时返回 `unknown`。

### `research.pause_for_human` 与 `research.resume`

遇到 CAPTCHA、登录要求、策略阻挡或不确定挑战时，追加 ToolCall 和 TaskBlocked 事件，将任务置为 `BLOCKED(human_feedback)`，停止该任务后续浏览器调用。返回 `human_verification_required`、原因、URL、已完成步骤、人工下一步和 `task_id`。不得保存 Cookie、密码、令牌、验证码答案或浏览器 profile。

恢复必须经过 Task & State Manager。必须存在由可信人工交互通道产生、且绑定 `task_id`、目标 URL 和暂停原因的 `HumanFeedbackRecorded` 事件；模型对话中的“我已验证”不构成凭据。恢复前重新检查运行模式、Policy Gate、工具版本、预算、冲突和版本漂移。恢复事件追加到事件日志，重复恢复必须幂等；检查失败时保持 BLOCKED。

## 4. 统一结果

每个工具返回 `status`（`success` / `human_verification_required` / `blocked` / `error`）、`source_url`、`final_url`、`title`、`retrieved_at`、`content`、`challenge_type`、`evidence_ref`、`resume_task_id` 和 `warnings`。成功结果必须有来源和获取时间；被策略拒绝的操作不得自动重试；错误必须带稳定错误码。输出和日志不得包含 Cookie、Authorization、API key 或访问令牌。

## 5. 证据与记忆

成功获取的来源作为只追加 Evidence 保存，至少记录请求 URL、最终 URL、provider、获取时间、工具/提取器版本、内容类型、内容哈希、响应状态、重定向链、警告、调用 ID 和外发声明。原始响应保存在 Evidence Store；派生摘要作为引用 `evidence_id` 的 Observation，不能替代原始证据。网页声明不能自动成为 `VALIDATED` KnowledgeItem。内容变化时新增证据而非覆盖旧记录；来源冲突按 Runtime Contract 创建 Conflict 并进入 `BLOCKED(conflict)`。

## 6. Provider 策略

优先使用第一方官方 API、获批搜索 API、公开 HTTP 页面，最后才使用显式启用且经过审查的 Browser MCP。远程 provider 默认关闭。启用前必须审查数据接收方、外发字段、保留期限、许可、依赖、日志与成本，并符合 Runtime Contract §10.6。MVP 不安装 CAPTCHA-solving provider；未来评估必须作为独立提案审查授权范围、条款、数据处理、费用和安全性。

## 7. 配置草案

```yaml
research_browser:
  enabled: false
  providers: []
  modes: [offline-research]
  max_search_results: 10
  connect_timeout_seconds: 5
  read_timeout_seconds: 20
  max_redirects: 5
  max_response_bytes: 2000000
  max_extracted_chars: 30000
  allowed_schemes: [https]
  allowed_ports: [443]
  block_private_networks: true
  require_human_for_challenges: true
  execute_javascript: false
  forward_cookies: false
  save_evidence: true
```

这是设计样例，不是当前可读取配置。秘密不得写入 YAML；凭据只能通过项目批准的秘密管理机制注入。

## 8. 失败与停止规则

- 受限网络目标、未声明外发或受保护数据：`POLICY_DENIED`，不重试。
- CAPTCHA、登录或访问挑战：`BLOCKED(human_feedback)`，不自动求解。
- HTTP 429：尊重 `Retry-After`，并受预算约束。
- HTTP 403、robots 或站点策略禁止：返回 `blocked`，不轮换身份或伪装请求。
- 超时/provider 故障：有界重试；预算耗尽后 `BLOCKED(budget)` 或返回结构化错误。
- 输出 schema 校验失败：`POSTCONDITION_FAILED`，不记录为成功证据。
- 发现患者信息：停止处理，按数据治理流程处置，不发送给外部 provider。

## 9. 验收测试

- RB-01：仅 `offline-research` 注册，其他模式不自动注册。
- RB-02：loopback、私有 IPv4/IPv6、link-local、metadata 地址均被拒绝。
- RB-03：DNS rebinding、重定向到受限地址、非 HTTP(S) scheme、凭据 URL 均被拒绝。
- RB-04：重定向、超时、响应体、解压后大小和提取字符数受限。
- RB-05：Cookie、Authorization、API key 不会转发或写入日志。
- RB-06：提示注入页面不会改变策略、运行模式或工具注册。
- RB-07：挑战分类正确，且没有自动求解或绕过调用。
- RB-08：挑战后任务 BLOCKED，期间没有新的浏览器调用。
- RB-09：没有绑定 `task_id` 的可信人工反馈时无法恢复；重复恢复幂等。
- RB-10：恢复时工具版本或策略变化触发 `BLOCKED(drift)`。
- RB-11：证据只追加、哈希稳定，Observation 引用真实证据。
- RB-12：provider 故障、429 和超时遵守预算。
- RB-13：远程 provider 默认关闭；未声明外发被拒绝。
- RB-14：浏览器适配器不能调用 CAD 写入或受保护评估接口。
- RB-15：从事件日志恢复后，暂停原因、已完成步骤和待办与持久记录一致。

## 10. 与 Runtime Contract 的映射

遵守 `05-agent-runtime-spec.md` §2 的 I1、I2、I3、I8、I9、I10、I11；运行模式见 §4；BLOCKED 语义见 §6；工具注册与结果验证见 §7；证据和 Observation 见 §8；恢复与版本漂移见 §9；权限与外发见 §10；预算见 §13。RB-01 至 RB-15 应纳入 §14 的可执行验收套件。

## 11. 实施顺序

1. 审查本规范并确定 provider 与外发策略。
2. 实现 provider-neutral schema、Policy Gate 注册定义和结果 envelope。
3. 先写单元测试和本地 HTTP fixture，再实现只读公开页面抓取。
4. 实现证据写入、调用审计与挑战暂停/恢复事件。
5. 加入 SSRF、提示注入、秘密脱敏、预算和恢复回归测试。
6. 最后接入可选 Browser MCP；外部服务保持显式 opt-in。

在 RB-01 至 RB-15 通过前，不得在真实病例或患者数据上运行。本文不声称实现已经存在。
