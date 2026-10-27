import type { Candidate } from '@cadcopilot/contracts';
import { CORRESPONDENCE_LABEL } from '../presenters/labels';
import type { CandidateView } from '../presenters/quality';

const W = 480;
const H = 200;
const X0 = 44;
const X1 = 468;
const Y_TOP = 26;
const Y_BOTTOM = 160;
const Y_ZERO = (Y_TOP + Y_BOTTOM) / 2;
const RANGE_UM = 160;

const ANCHORS: Array<[number, string]> = [
  [0, '近中'],
  [0.25, '颊侧'],
  [0.5, '远中'],
  [0.75, '舌侧'],
  [1, '近中'],
];

const x = (t: number) => X0 + (X1 - X0) * t;
const y = (um: number) => Y_ZERO - (Math.max(-RANGE_UM, Math.min(RANGE_UM, um)) / RANGE_UM) * ((Y_BOTTOM - Y_TOP) / 2);

/**
 * Margin line "unrolled" along normalised arc length on S_0 (02 §6.3, §11).
 * Regions are shaded by correspondence state; the displacement profile is
 * drawn only for adoptable candidates and only inside MATCHED regions.
 */
export function MarginLineChart({ candidate, view, simulated }: { candidate: Candidate; view: CandidateView; simulated: boolean }) {
  const groups = candidate.regions
    .filter((r) => view.showsDisplacement(r))
    .map((r) => ({ region: r, points: view.samples.filter((s) => s.t >= r.t[0] && s.t <= r.t[1]) }))
    .filter((g) => g.points.length > 1);

  const summary = candidate.regions
    .map((r) => `${r.label}（t ${r.t[0]}–${r.t[1]}）${CORRESPONDENCE_LABEL[r.correspondence]}`)
    .join('；');

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`margin line 展开图：${summary}${view.adoptable ? '；显示候选横向位移' : '；不显示候选几何'}`}>
        <title>margin line 展开图（模拟数据）</title>
        <rect x={X0} y={Y_TOP} width={X1 - X0} height={Y_BOTTOM - Y_TOP} className="chart-plot" />
        {candidate.regions.map((r) => (
          <g key={r.regionId}>
            <rect
              x={x(r.t[0])}
              y={Y_TOP}
              width={x(r.t[1]) - x(r.t[0])}
              height={Y_BOTTOM - Y_TOP}
              className={`chart-region corr-${r.correspondence.toLowerCase()}`}
            />
            <text x={(x(r.t[0]) + x(r.t[1])) / 2} y={Y_TOP - 8} textAnchor="middle" className="chart-region-label">
              {r.label} · {CORRESPONDENCE_LABEL[r.correspondence]}
            </text>
          </g>
        ))}
        <line x1={X0} x2={X1} y1={Y_ZERO} y2={Y_ZERO} className="chart-zero" />
        {ANCHORS.map(([t, label]) => (
          <g key={`${t}-${label}`}>
            <line x1={x(t)} x2={x(t)} y1={Y_BOTTOM} y2={Y_BOTTOM + 4} className="chart-axis" />
            <text x={x(t)} y={Y_BOTTOM + 16} textAnchor="middle" className="chart-tick">
              {label}
            </text>
          </g>
        ))}
        <text x={X0 - 6} y={Y_TOP + 10} textAnchor="end" className="chart-tick">
          冠方
        </text>
        <text x={X0 - 6} y={Y_ZERO + 4} textAnchor="end" className="chart-tick">
          0
        </text>
        <text x={X0 - 6} y={Y_BOTTOM - 2} textAnchor="end" className="chart-tick">
          龈方
        </text>
        {groups.map((g) => (
          <path
            key={g.region.regionId}
            className="chart-profile"
            d={g.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.lateralUm).toFixed(1)}`).join(' ')}
          />
        ))}
        {!view.adoptable && (
          <text x={(X0 + X1) / 2} y={Y_ZERO - 10} textAnchor="middle" className="chart-withheld">
            未展示候选几何
          </text>
        )}
        {simulated && (
          <text x={X1 - 4} y={Y_BOTTOM - 6} textAnchor="end" className="chart-watermark">
            模拟数据
          </text>
        )}
      </svg>
      <figcaption>
        横轴：以 S_0 为参考的归一化弧长；纵轴：横向位移 d·b（±{RANGE_UM} μm）。
        {view.adoptable ? '曲线只画在 MATCHED 区域内。' : `${view.withheldReason ?? ''}。`}
      </figcaption>
    </figure>
  );
}
