# ADR-0002 · 先在进程内运行模拟 Runtime，网络传输保持占位

- 状态：临时（2026-10-27）。替换条件见扩展点 X1。
- 相关：`packages/runtime`，`packages/integrations/src/runtime-transport/http.ts`，`apps/web/src/app`

## 背景

没有后端服务，05 也还在 PR #3 中。端到端骨架需要一个真实执行状态机与规则的 Runtime，这样界面展示的状态才来自 Runtime，而不是来自界面脚本。同时，任何地方都不能暗示已经有真实后端、真实 CAD 或模型。

## 决定

1. Runtime 分三部分：
   - `engine/`：状态机、Policy Gate、步骤执行、审批、事件日志；
   - `host/`：在 engine 之上实现全部 UI 端口；
   - `simulation/`：模拟环境。
   engine 和 host 是真实代码，目前在浏览器进程内运行。
2. 模拟环境提供合成数据集、合成 CAD、脚本模型、fixture Research Browser 与模拟工具。
3. 场景只是「故障计划 + 脚本 agent」，不编排任务或步骤状态。用户看到的状态都是 engine 对环境的反应。出现规范不允许的转移时，engine 直接抛错。
4. 模拟状态处处可见：
   - `DeploymentInfo.simulated`；
   - 逐项的 `integrations`（模拟 / 占位 / 已连接）；
   - 页头标记；
   - 审批卡片上的「模拟部署，审批无实际效力」；
   - 原型控制面板（只在模拟部署的组装层出现）。
5. 网络传输是占位：`VITE_RUNTIME_TRANSPORT=http` 时，每个调用都以不可重试的 `NOT_IMPLEMENTED` 失败，界面不显示任何任务状态。
6. 调度器可以替换（实时、即时、手动、可调速），测试因此是确定性的。

## 后果

- 端到端流程可以完整运行和测试：创建任务 → Runtime 执行 → 事件 → 界面。engine 和 host 以后可以原样放到网络传输后面。
- 没有认证，没有持久化，刷新即重置。
- 进程内运行会掩盖网络问题，例如延迟、断线和部分失败。为此端口一律是异步的，事件带 `seq` 以便续读，审批记录有 300 ms 的模拟延迟，用来验证界面不会提前显示「已批准」。真正的断线续读要到 X1 才能验证。

## 何时重新审视

实现 X1（HTTP/SSE 传输与独立 Runtime 服务）时，本记录被取代。
