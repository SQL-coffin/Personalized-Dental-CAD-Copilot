# ADR-0001 · 按层划分 workspace 包，依赖方向由脚本强制

- 状态：已采纳（2026-10-27）
- 相关：[架构总览](../README.md) 第 1–2 节，`scripts/check-boundaries.mjs`

## 背景

结构优先阶段之前，仓库只有设计文档和一个前端原型。原型的 UI ↔ Runtime 契约和模拟 Runtime 都放在前端目录里。

要同时推进以下模块：

- 前端；
- Runtime；
- 数据层；
- Agent / 工具层；
- 研究层；
- 集成层。

它们之间的规则来自 05：审批只来自审批记录，模型输出不具权威，质量闸门失败即关闭。这些规则不能因为界面方便而被绕过。代码现在在浏览器中运行，将来要能放进独立的 Runtime 服务。

## 决定

1. 使用 npm workspaces，所有包都以 `@cadcopilot/*` 命名：
   - `packages/contracts`、`data`、`agent-tools`、`research`、`runtime`、`integrations`；
   - `apps/web`，其中 `src/ui` 是产品界面，`src/app` 是组装层。
2. 依赖方向：

   | 模块 | 可以依赖 |
   |---|---|
   | data | contracts |
   | agent-tools | contracts |
   | research | contracts、data |
   | runtime | contracts、data、agent-tools、research |
   | integrations | contracts、agent-tools |
   | web/ui | contracts |
   | web/app | contracts、runtime、integrations |

3. `scripts/check-boundaries.mjs`（`npm run check:boundaries`，包含在 `npm run check` 中）强制以下规则：
   - 内部依赖与相对路径不越层；
   - 领域包没有运行时第三方依赖，测试只用 `vitest`；
   - Web 只用 React 与测试库；
   - 共享源码不用 `node:` 内置模块；
   - 内部依赖必须在 `package.json` 中声明。
4. 包直接导出 TypeScript 源码（`"exports": {".": "./src/index.ts"}`），不单独构建。类型检查按包进行，测试使用一个 Vitest workspace。

## 后果

- UI 无法引用 Runtime 内部或适配器，只能看到契约。换 Runtime 只改组装层。
- 规则所在的层（engine、Policy Gate、数据约束）不依赖界面或外部系统，可以单独测试。
- 包导出的是 TS 源码，所以不经 Vite / Vitest 消费它们（例如将来的 Node 服务进程）时，需要 TS 加载器或构建步骤。新增服务时再决定。
- 边界检查是基于 import / export 语句的静态脚本，不是完整的模块图工具。新增层或第三方依赖时要同步修改脚本，并在 ADR 中记录。

## 何时重新审视

- 新增 Runtime 服务进程（需要构建或加载方式）；
- 某个领域包确实需要第三方依赖；
- 新增层。
