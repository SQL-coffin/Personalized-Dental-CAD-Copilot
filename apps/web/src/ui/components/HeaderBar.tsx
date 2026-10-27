import type { DeploymentInfo } from '@cadcopilot/contracts';
import { MODE_LABEL } from '../presenters/labels';
import { Badge } from './primitives';

export function HeaderBar({ deployment }: { deployment: DeploymentInfo }) {
  const eTools = deployment.registeredTools.filter((t) => t.tier === 'E').length;
  return (
    <header className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="brand-mark">
          <path d="M7 3c-2.2 0-4 1.9-4 4.4 0 3 1.3 5 2 7.6.6 2.4.9 6 2.6 6 1.6 0 1.6-3.8 2.6-5.4.4-.6 1.2-.6 1.6 0 1 1.6 1 5.4 2.6 5.4 1.7 0 2-3.6 2.6-6 .7-2.6 2-4.6 2-7.6C21 4.9 19.2 3 17 3c-1.9 0-3 1.2-5 1.2S8.9 3 7 3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <div>
          <span className="brand-name">CAD Copilot</span>
          <span className="brand-sub">个性化牙科 CAD 助手 · 前端原型</span>
        </div>
      </div>
      <div className="topbar-meta" aria-label="部署信息">
        <Badge tone="neutral" title={`运行模式由部署配置决定：${deployment.mode}`}>
          模式：{MODE_LABEL[deployment.mode]}
        </Badge>
        {deployment.simulated && <Badge tone="waiting">模拟部署</Badge>}
        <Badge tone={deployment.cadConnected ? 'success' : 'muted'}>{deployment.cadConnected ? 'CAD 已连接' : 'CAD 未连接'}</Badge>
        <Badge tone="neutral" title="当前模式下注册的工具；未注册的级别根本不存在">
          工具 {deployment.registeredTools.length} 个{eTools === 0 ? ' · 无写入工具' : ` · 含 ${eTools} 个 E 级`}
        </Badge>
        <span className="identity" title={deployment.identity.authenticated ? '已通过身份验证' : '未经身份验证'}>
          {deployment.identity.displayName}
          {!deployment.identity.authenticated && <span className="muted-text">（未认证）</span>}
        </span>
      </div>
    </header>
  );
}

export function SimulationBanner() {
  return (
    <div className="sim-banner" role="note">
      <strong>模拟环境</strong>
      <span>Runtime 的回应由脚本生成，与输入内容无关；病例与几何均为合成数据；未连接任何 CAD 软件；审批没有实际效力。</span>
    </div>
  );
}
