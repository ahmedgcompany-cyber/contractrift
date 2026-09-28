import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type Baseline, type CheckResult, type DriftEvent, type Incident, type Monitor, type RunSummary } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorNote, errorText, Loading, PageHead, Spinner, StatusBadge, useConfirm, useToast } from '../components/ui';
import { ago, dateTime, duration, interval, targetOf } from '../format';
import { DriftCard } from './Drift';
import { IncidentTable } from './Incidents';

type Tab = 'overview' | 'results' | 'drift' | 'baseline' | 'incidents';

function LatencyChart({ results }: { results: CheckResult[] }) {
  const pts = [...results].reverse();
  if (pts.length < 2) return <p className="cell-sub">The chart appears after a few checks.</p>;
  const W = 800;
  const H = 120;
  const max = Math.max(...pts.map((p) => p.durationMs), 1);
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (d: number) => H - 8 - (d / max) * (H - 20);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.durationMs).toFixed(1)}`).join('');
  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Latency of the last ${pts.length} checks; peak ${max} ms`}
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--rule)" strokeDasharray="2 6" />
      ))}
      <path d={`${line}L${W},${H}L0,${H}Z`} fill="var(--signal-soft)" opacity="0.6" />
      <path d={line} fill="none" stroke="var(--signal)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {pts.map((p, i) => (p.ok ? null : <circle key={p.id} cx={x(i)} cy={y(p.durationMs)} r="3.5" fill="var(--down)" />))}
      <text x="4" y="12" fontSize="10" fill="var(--ink-3)" fontFamily="var(--mono)">
        peak {max} ms
      </text>
    </svg>
  );
}

function ResultRow({ r }: { r: CheckResult }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="clickable" onClick={() => setOpen(!open)} aria-expanded={open}>
        <td>{r.ok ? <span className="badge up">ok</span> : <span className="badge down">{r.errorCode ?? 'fail'}</span>}</td>
        <td className="cell-sub" title={dateTime(r.startedAt)}>
          {ago(r.startedAt)}
        </td>
        <td className="mono">{r.statusCode ?? '—'}</td>
        <td className="num mono">{duration(r.durationMs)}</td>
        <td>
          <div className="cell-sub" style={{ whiteSpace: 'normal' }}>
            {r.message}
          </div>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={5} style={{ background: 'var(--panel-2)' }}>
            <ul className="assertions">
              {r.assertions.map((a, i) => (
                <li key={i} className={a.ok ? 'ok' : 'fail'}>
                  <span className="mark">{a.ok ? '✓' : '✗'}</span>
                  <span>
                    <strong>{a.name}</strong> — {a.message}
                  </span>
                </li>
              ))}
            </ul>
            {Object.keys(r.meta).length ? <pre className="excerpt">{JSON.stringify(r.meta, null, 2)}</pre> : null}
            {r.responseExcerpt ? (
              <>
                <div className="label-text" style={{ marginTop: 8 }}>
                  Response excerpt (secrets redacted)
                </div>
                <pre className="excerpt">{r.responseExcerpt}</pre>
              </>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function MonitorDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('overview');

  const monitor = useQuery({
    queryKey: ['monitor', id],
    queryFn: () => api.get<{ monitor: Monitor }>(`/monitors/${id}`),
    refetchInterval: 15_000,
  });
  const results = useQuery({
    queryKey: ['results', id],
    queryFn: () => api.get<{ results: CheckResult[] }>(`/monitors/${id}/results?limit=100`),
    refetchInterval: 15_000,
  });
  const drift = useQuery({
    queryKey: ['drift', 'monitor', id],
    queryFn: () => api.get<{ events: DriftEvent[] }>(`/drift?monitorId=${id}&limit=50`),
  });
  const baseline = useQuery({ queryKey: ['baseline', id], queryFn: () => api.get<Baseline>(`/monitors/${id}/baseline`) });
  const incidents = useQuery({
    queryKey: ['incidents', 'monitor', id],
    queryFn: () => api.get<{ incidents: Incident[] }>(`/incidents?monitorId=${id}&limit=50`),
  });

  const invalidate = () => {
    for (const k of [['monitor', id], ['results', id], ['drift'], ['baseline', id], ['incidents'], ['summary'], ['monitors']])
      void qc.invalidateQueries({ queryKey: k });
  };
  const run = useMutation({
    mutationFn: () => api.post<RunSummary>(`/monitors/${id}/run`),
    onSuccess: (r) => {
      const parts = [r.result.ok ? 'Check passed' : `Check failed: ${r.result.message}`];
      if (r.baseline === 'learning') parts.push('baseline still learning');
      if (r.drift?.isNew) parts.push(`${r.drift.severity} drift detected`);
      if (r.incident === 'opened') parts.push('incident opened');
      if (r.incident === 'resolved') parts.push('incident resolved');
      toast(parts.join(' · '), r.result.ok ? 'ok' : 'error');
      invalidate();
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`/monitors/${id}`, { enabled }),
    onSuccess: (_d, enabled) => {
      toast(enabled ? 'Monitor resumed.' : 'Monitor paused.');
      invalidate();
    },
    onError: (err) => toast(errorText(err), 'error'),
  });

  if (monitor.isLoading) return <Loading />;
  if (monitor.error) return <ErrorNote error={monitor.error} retry={() => monitor.refetch()} />;
  const m = monitor.data!.monitor;
  const openDrift = drift.data?.events.filter((e) => e.status === 'open').length ?? 0;
  const b = baseline.data;

  return (
    <>
      <PageHead
        eyebrow={`${m.kind.toUpperCase()} monitor`}
        title={
          <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {m.name} <StatusBadge status={m.status} enabled={m.enabled} />
          </span>
        }
        sub={<span className="mono">{targetOf(m.config)}</span>}
        actions={
          can('editor') ? (
            <>
              <button className="btn primary" onClick={() => run.mutate()} disabled={run.isPending}>
                {run.isPending ? <Spinner /> : null} Run check now
              </button>
              <Link className="btn" to={`/monitors/${id}/edit`}>
                Edit
              </Link>
              <button className="btn" onClick={() => toggle.mutate(!m.enabled)} disabled={toggle.isPending}>
                {m.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                className="btn danger"
                onClick={() =>
                  confirm.ask({
                    title: `Delete “${m.name}”?`,
                    body: 'Its check history, baseline, drift events and incidents are deleted permanently.',
                    confirmLabel: 'Delete monitor',
                    danger: true,
                    action: async () => {
                      await api.del(`/monitors/${id}`);
                      toast('Monitor deleted.');
                      void qc.invalidateQueries({ queryKey: ['monitors'] });
                      void qc.invalidateQueries({ queryKey: ['summary'] });
                      nav('/monitors');
                    },
                  })
                }
              >
                Delete
              </button>
            </>
          ) : null
        }
      />
      {confirm.dialog}
      {m.lastError && m.status !== 'up' ? (
        <div className="note error" style={{ marginBottom: 16 }}>
          <strong>Last failure:</strong> {m.lastError}
        </div>
      ) : null}
      <div className="tabs" role="tablist">
        {(
          [
            ['overview', 'Overview'],
            ['results', 'Check history'],
            ['drift', `Drift${openDrift ? ` (${openDrift})` : ''}`],
            ['baseline', 'Baseline'],
            ['incidents', 'Incidents'],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h2>Latency</h2>
              <span className="cell-sub">last {results.data?.results.length ?? 0} checks · red = failed</span>
            </div>
            <div className="panel-body">{results.data ? <LatencyChart results={results.data.results} /> : <Loading />}</div>
          </section>
          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>Configuration</h2>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Interval</dt>
                  <dd>
                    every {interval(m.intervalSeconds)} · timeout {duration(m.timeoutMs)}
                  </dd>
                  <dt>Incident after</dt>
                  <dd>{m.failureThreshold} consecutive failures</dd>
                  <dt>Drift</dt>
                  <dd>{m.driftEnabled ? `on · baseline from ${m.baselineSamples} sample(s)` : 'off'}</dd>
                  <dt>Ignored paths</dt>
                  <dd className="mono">{m.ignorePaths.length ? m.ignorePaths.join(', ') : '—'}</dd>
                  <dt>Secrets</dt>
                  <dd>
                    {[...m.secretKeys.headers.map((h) => `header ${h}`), ...(m.secretKeys.apiKey ? ['API key'] : [])].join(', ') || '—'}
                    <span className="cell-sub"> (values never shown)</span>
                  </dd>
                  <dt>Tags</dt>
                  <dd>
                    {m.tags.length
                      ? m.tags.map((t) => (
                          <span className="tag" key={t}>
                            {t}
                          </span>
                        ))
                      : '—'}
                  </dd>
                  <dt>Last check</dt>
                  <dd title={dateTime(m.lastCheckedAt)}>
                    {ago(m.lastCheckedAt)} · next {ago(m.nextRunAt)}
                  </dd>
                </dl>
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Latest result</h2>
              </div>
              <div className="panel-body">
                {results.data?.results[0] ? (
                  <ul className="assertions">
                    {results.data.results[0].assertions.map((a, i) => (
                      <li key={i} className={a.ok ? 'ok' : 'fail'}>
                        <span className="mark">{a.ok ? '✓' : '✗'}</span>
                        <span>
                          <strong>{a.name}</strong> — {a.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="Not checked yet">
                    {m.enabled ? 'The scheduler will run it shortly, or use “Run check now”.' : 'The monitor is paused.'}
                  </Empty>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {tab === 'results' ? (
        <section className="panel">
          {results.isLoading ? (
            <Loading />
          ) : results.data?.results.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>When</th>
                    <th>HTTP</th>
                    <th className="num">Duration</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {results.data.results.map((r) => (
                    <ResultRow key={r.id} r={r} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No checks yet" />
          )}
        </section>
      ) : null}

      {tab === 'drift' ? (
        <section className="panel">
          {drift.data?.events.length ? (
            drift.data.events.map((e) => <DriftCard key={e.id} event={e} showMonitor={false} />)
          ) : (
            <Empty title="No drift recorded">
              {b?.state === 'locked' ? 'Responses still match the baseline.' : 'Drift detection starts once the baseline is learned.'}
            </Empty>
          )}
        </section>
      ) : null}

      {tab === 'baseline' ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Learned structure</h2>
              <div className="cell-sub">
                {b?.state === 'locked'
                  ? `Locked ${ago(b.lockedAt)} from ${b.samples} sample(s).`
                  : b?.state === 'learning'
                    ? `Learning: ${b.samples} of ${b.samplesRequired} samples.`
                    : 'No baseline yet — it is learned from the next successful checks.'}
                {b?.truncated ? ' Document was truncated at 5,000 paths.' : ''}
              </div>
            </div>
            {can('editor') && b && b.state !== 'none' ? (
              <button
                className="btn small danger"
                onClick={() =>
                  confirm.ask({
                    title: 'Reset baseline?',
                    body: 'The structure is re-learned from the next checks. Existing drift events are kept.',
                    confirmLabel: 'Reset baseline',
                    danger: true,
                    action: async () => {
                      await api.del(`/monitors/${id}/baseline`);
                      toast('Baseline reset.');
                      invalidate();
                    },
                  })
                }
              >
                Reset baseline
              </button>
            ) : null}
          </div>
          {b && Object.keys(b.signature).length ? (
            <div className="panel-body" style={{ borderBottom: '1px solid var(--rule)' }}>
              <div className="label-text" style={{ marginBottom: 6 }}>
                Tracked values
              </div>
              <dl className="kv">
                {Object.entries(b.signature).map(([k, s]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{s.label}</dt>
                    <dd className="mono">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {b?.paths.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Types</th>
                    <th>Presence</th>
                  </tr>
                </thead>
                <tbody>
                  {b.paths.map((p) => (
                    <tr key={p.path}>
                      <td className="mono">{p.path}</td>
                      <td className="mono">{p.types.join(' | ')}</td>
                      <td>{p.required ? <span className="badge outline">always</span> : <span className="badge">optional</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === 'incidents' ? (
        <section className="panel">
          {incidents.data?.incidents.length ? (
            <IncidentTable incidents={incidents.data.incidents} showMonitor={false} />
          ) : (
            <Empty title="No incidents" />
          )}
        </section>
      ) : null}
    </>
  );
}
