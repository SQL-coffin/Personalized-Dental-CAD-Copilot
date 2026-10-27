import type { Candidate, DecisionRecord } from '@cadcopilot/contracts';
import { formatTime, percent, shortHash } from '../format';
import { CORRESPONDENCE_LABEL, DIRECTION_LABEL, QUALITY_RESULT_LABEL } from '../presenters/labels';
import { candidateView, criterionPassed } from '../presenters/quality';
import { MarginLineChart } from './MarginLineChart';
import { Badge, KeyValue, Mono, StatusIcon } from './primitives';

export function CandidateCard({
  candidate,
  decision,
  simulated,
}: {
  candidate: Candidate;
  decision: DecisionRecord | undefined;
  simulated: boolean;
}) {
  const view = candidateView(candidate);
  return (
    <article className="candidate" aria-label={`候选 ${candidate.candidateId}`}>
      <header className="candidate-head">
        <div>
          <h3>
            候选 <Mono>{candidate.candidateId}</Mono>
          </h3>
          <p className="muted-text">
            基础版本 <Mono>{candidate.baseVersion.versionId}</Mono> · {formatTime(candidate.createdAt)}
          </p>
        </div>
        {view.adoptable ? (
          <Badge tone="success">可采纳</Badge>
        ) : (
          <Badge tone="waiting">仅诊断信息</Badge>
        )}
      </header>

      {!view.adoptable && candidate.hint && <p className="hint">{candidate.hint}</p>}
      {decision?.unableToJudge && (
        <p className="unable" role="note">
          <strong>无法可靠判断。</strong>证据不足以给出逐点修改建议。
        </p>
      )}

      <MarginLineChart candidate={candidate} view={view} simulated={simulated} />

      <div className="pq-grid">
        <PreferenceBox candidate={candidate} />
        <QualityBox candidate={candidate} view={view} />
      </div>
      <p className="field-help">偏好与质量分开评价，不合并为一个「AI 置信度」；偏好值不改变闸门结论。</p>

      <RegionsTable candidate={candidate} view={view} />

      <details>
        <summary>来源与哈希</summary>
        <KeyValue
          rows={[
            ['候选哈希', <Mono key="h">{candidate.candidateHash}</Mono>],
            ['Predictor', <Mono key="p">{`${candidate.provenance.predictor.id}@${candidate.provenance.predictor.version}`}</Mono>],
            ['Geometry Engine', <Mono key="g">{`${candidate.provenance.geometryEngine.id}@${candidate.provenance.geometryEngine.version}`}</Mono>],
            ['参数哈希', <Mono key="ph">{candidate.provenance.paramsHash}</Mono>],
            ['基础版本范围', candidate.baseVersion.scope.join('、')],
            ['坐标系版本', candidate.geometry?.frameVersion ?? '—'],
          ]}
        />
      </details>

      {decision && <DecisionView decision={decision} />}
    </article>
  );
}

function PreferenceBox({ candidate }: { candidate: Candidate }) {
  const p = candidate.preference;
  return (
    <section className="pq-box" aria-label="个人偏好">
      <h4>个人偏好符合程度</h4>
      <p className="pq-value">
        {p.score.toFixed(2)}
        <span className="muted-text">
          {' '}
          区间 {p.interval[0].toFixed(2)}–{p.interval[1].toFixed(2)}
        </span>
      </p>
      <div className="meter" aria-hidden="true">
        <span className="meter-band" style={{ left: percent(p.interval[0]), width: percent(p.interval[1] - p.interval[0]) }} />
        <span className="meter-dot" style={{ left: percent(p.score) }} />
      </div>
      <p className="field-help">{p.basis}。只表示与你过去修正习惯的符合程度，不代表设计质量。</p>
    </section>
  );
}

function QualityBox({ candidate, view }: { candidate: Candidate; view: ReturnType<typeof candidateView> }) {
  const q = candidate.quality;
  const g = view.gate;
  const passedCount = q.results.filter(criterionPassed).length;
  return (
    <section className="pq-box" aria-label="质量闸门">
      <h4>质量闸门</h4>
      <p className={`pq-value tone-text-${g.passed ? 'success' : 'danger'}`}>
        {g.passed ? '全部通过' : '未通过'}
        <span className="muted-text">
          {' '}
          {passedCount}/{q.requiredCriteria.length} 项可评价且通过
        </span>
      </p>
      {g.inconsistent && (
        <p className="inline-error" role="alert">
          Runtime 报告「通过」，但逐项结果不支持该结论；界面按未通过处理。
        </p>
      )}
      <ul className="criteria">
        {q.results.map((r) => {
          const ok = criterionPassed(r);
          const label = r.evaluationValidity === 'not_evaluable' ? '不可评价' : QUALITY_RESULT_LABEL[r.qualityResult];
          return (
            <li key={r.criterionId}>
              <StatusIcon tone={ok ? 'success' : 'danger'} />
              <span>
                {r.label}：<strong>{label}</strong>
                {r.detail && <span className="muted-text">（{r.detail}）</span>}
              </span>
            </li>
          );
        })}
        {g.missing.map((id) => (
          <li key={id}>
            <StatusIcon tone="danger" />
            <span>
              <Mono>{id}</Mono>：<strong>结果缺失</strong>（视为未通过）
            </span>
          </li>
        ))}
      </ul>
      <p className="field-help">
        标准集 <Mono>{q.criteriaSetVersion}</Mono>。通过闸门只是展示与执行的必要条件，不代表临床或制造质量合格。
      </p>
    </section>
  );
}

function RegionsTable({ candidate, view }: { candidate: Candidate; view: ReturnType<typeof candidateView> }) {
  return (
    <div className="table-scroll">
      <table className="regions">
        <caption>区域</caption>
        <thead>
          <tr>
            <th>区域</th>
            <th>弧长区间</th>
            <th>曲线对应</th>
            <th>建议变化</th>
          </tr>
        </thead>
        <tbody>
          {candidate.regions.map((r) => (
            <tr key={r.regionId}>
              <td>{r.label}</td>
              <td>
                <Mono>
                  [{r.t[0]}, {r.t[1]}]
                </Mono>
              </td>
              <td>
                <Badge tone={r.correspondence === 'MATCHED' ? 'success' : 'waiting'}>{CORRESPONDENCE_LABEL[r.correspondence]}</Badge>
              </td>
              <td>
                {view.showsDisplacement(r) && r.displacement
                  ? `${DIRECTION_LABEL[r.displacement.direction]}，最大 ${r.displacement.maxUm} μm，平均 ${r.displacement.meanUm} μm`
                  : r.correspondence === 'MATCHED'
                    ? '不展示（候选未通过闸门）'
                    : '仅区域提示，不给逐点位移'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecisionView({ decision }: { decision: DecisionRecord }) {
  return (
    <details className="decision">
      <summary>
        决策记录 <Mono>{decision.decisionId}</Mono> · {decision.outcome}
      </summary>
      <KeyValue
        rows={[
          ['工作假设', decision.hypothesis],
          ['观察', <RefList key="o" refs={decision.observations} />],
          ['证据', <RefList key="e" refs={decision.evidence} />],
          [
            '其他方案',
            <ul key="a" className="plain-list">
              {decision.alternatives.map((a) => (
                <li key={a.label}>
                  {a.label}：<span className="muted-text">{a.whyNot}</span>
                </li>
              ))}
            </ul>,
          ],
          ['理由摘要', decision.rationale],
          ['不确定性', decision.uncertainty],
          ['结论', decision.outcome],
        ]}
      />
      <p className="field-help">理由摘要是可检查的摘要，不是证据；证据以引用形式列出。</p>
    </details>
  );
}

function RefList({ refs }: { refs: DecisionRecord['evidence'] }) {
  return (
    <ul className="plain-list">
      {refs.map((r) => (
        <li key={r.ref} title={r.ref}>
          {r.stance && <Badge tone={r.stance === 'supports' ? 'success' : 'danger'}>{r.stance === 'supports' ? '支持' : '反对'}</Badge>} {r.label}{' '}
          <Mono>{shortHash(r.ref, 18)}</Mono>
        </li>
      ))}
    </ul>
  );
}
