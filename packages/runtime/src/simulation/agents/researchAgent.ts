/**
 * Scripted stand-in for offline research (docs/06). Searches, fetches the
 * first source, and on an access challenge asks a human instead of trying to
 * get around it.
 */
import { TOOL_CATALOG, type Agent, type AgentSession, type ResearchFetchOutput, type ResearchSearchOutput } from '@cadcopilot/agent-tools';

export class ScriptedResearchAgent implements Agent {
  readonly agentId = 'research-engine.scripted-research';
  readonly version = '0.2.0-sim';

  async run(s: AgentSession): Promise<void> {
    await s.beginPlanning();
    await s.think(400);
    await s.say('我会检索公开研究资料并读取来源页面。检索只使用任务描述中的研究主题，不会发送任何病例或患者信息。');
    const ids = s.writePlan([
      { key: 'search', title: TOOL_CATALOG.researchSearch.title, purpose: '用获批的搜索 provider 检索（结果只是待核验的来源线索）', toolId: TOOL_CATALOG.researchSearch.toolId },
      { key: 'fetch', title: TOOL_CATALOG.researchFetch.title, purpose: '只读公开 HTTPS 页面，不执行 JavaScript，不提交表单', toolId: TOOL_CATALOG.researchFetch.toolId },
    ]);
    s.execute();

    const search = await s.runStep<{ query: string; limit: number }, ResearchSearchOutput>(ids.search!, { query: s.context.prompt, limit: 3 });
    if (search.kind !== 'succeeded') return this.end(s, false, '检索失败，没有可用的来源线索。');
    if (search.output.results.length === 0) {
      // The fetch step cannot run, and §6.3 defines no way to end a running
      // plan early; this surfaces as a Runtime fault (open item in docs/architecture).
      throw new Error('检索没有返回来源，计划中的读取步骤无法执行（§6.3 未定义提前结束计划）');
    }
    const [first, second] = search.output.results;
    let fetch = await s.runStep<{ url: string }, ResearchFetchOutput>(ids.fetch!, { url: first!.url });
    if (fetch.kind !== 'succeeded') return this.end(s, false, '读取来源失败。');

    if (fetch.output.status === 'human_verification_required') {
      const fb = await s.requestHumanFeedback({
        summary: '目标页面要求人工验证（CAPTCHA）。系统不会自动求解或绕过（06 §3）。',
        requiredAction:
          '你可以在自己的浏览器中处理后选择「继续」，系统会重新检查策略与版本后再读取；也可以改写计划，换用其他来源。系统不会保存 Cookie、密码或验证码答案。',
        allowedResponses: ['continue', 'replan'],
        stepId: ids.fetch!,
      });
      const resume = fb.kind === 'continue';
      await s.say(resume ? '已收到人工反馈。恢复前重新检查运行模式、策略、工具版本与预算，然后重新读取该页面。' : `按你的说明改写计划：「${fb.note ?? ''}」。`);
      const ids2 = s.writePlan(
        [{ key: 'fetch', title: resume ? '重新读取来源页面' : '读取替代来源', purpose: '只读公开 HTTPS 页面', toolId: TOOL_CATALOG.researchFetch.toolId }],
        resume ? '人工处理访问挑战后恢复' : '人工要求换用其他来源',
      );
      s.execute();
      fetch = await s.runStep<{ url: string }, ResearchFetchOutput>(ids2.fetch!, { url: resume || !second ? first!.url : second.url });
      if (fetch.kind !== 'succeeded') return this.end(s, false, '读取来源失败。');
    }

    if (fetch.output.status !== 'success') return this.end(s, true, `来源读取结果为 ${fetch.output.status}，没有保存证据。`);
    await s.complete(
      { summary: '已获取来源并存为证据。网页内容只作为待核验资料，不会自动成为已验证的知识。', cadWrite: 'none' },
      '验证：来源有 URL 与获取时间；摘要作为 Observation 引用原始证据。',
    );
  }

  /** `running` is false after a non-success result: the task is in PLANNING and needs an (empty) plan first. */
  private async end(s: AgentSession, running: boolean, summary: string): Promise<void> {
    if (!running) {
      s.writePlan([], '无法继续，结束任务');
      s.execute();
    }
    await s.complete({ summary, cadWrite: 'none' }, '验证：没有保存新的证据。');
  }
}
