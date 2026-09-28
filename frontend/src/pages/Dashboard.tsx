import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { api, type DriftEvent, type Incident, type MonitorPage, type Summary } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorNote, Loading, PageHead, SeverityBadge, Sparkline, StatusBadge } from '../components/ui';
import { ago, duration, targetOf } from '../format';

export function DashboardPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const summary = useQuery({ queryKey: ['summary'], queryFn: () => api.get<Summary>('/summary'), refetchInterval: 15_000 });
  const monitors = useQuery({
    queryKey: ['monitors', {}],
    queryFn: () => api.get<MonitorPage>('/monitors?limit=12'),
    refetchInterval: 15_000,
  });
  const drift = useQuery({
    queryKey: ['drift', 'open-5'],
    queryFn: () => api.get<{ events: DriftEvent[] }>('/drift?status=open&limit=5'),
    refetchInterval: 15_000,
  });
  const incidents = useQuery({
    queryKey: ['incidents', 'open'],
    queryFn: () => api.get<{ incidents: Incident[] }>('/incidents?status=open&limit=5'),
    refetchInterval: 15_000,
  });

  if (summary.isLoading || monitors.isLoading) return <Loading />;
  if (summary.error) return <ErrorNote error={summary.error} retry={() => summary.refetch()} />;
  const s = summary.data!;
  const list = monitors.data?.monitors ?? [];
  const attention = s.needsAttention;

  if (s.monitors.total === 0) {
    return (
      <>
        <PageHead eyebrow="Overview" title="Nothing is being watched yet" />
        <div className="panel">
          <Empty
            title="Add your first dependency"
            action={
              can('editor') ? (
                <Link className="btn primary" to="/monitors/new">
                  New monitor
                </Link>
              ) : null
            }
          >
            Point Tripline at a REST endpoint, an LLM API or an MCP server. It learns the response structure from the first checks and tells
            you when it goes down or silently changes.
          </Empty>
        </div>
      </>
    );
  }

  const failRate = s.checksLast24h.total ? ((s.checksLast24h.failed / s.checksLast24h.total) * 100).toFixed(1) : '0.0';
  return (
    <>
      <PageHead
        eyebrow="Overview"
        title={attention ? `${attention} dependenc${attention === 1 ? 'y needs' : 'ies need'} attention` : 'All upstreams holding steady'}
        sub={`${s.monitors.total} monitor${s.monitors.total === 1 ? '' : 's'} · refreshed every 15 s`}
        actions={
          can('editor') ? (
            <Link className="btn primary" to="/monitors/new">
              New monitor
            </Link>
          ) : null
        }
      />
      <section className="readouts" aria-label="Key figures">
        <Link to="/monitors?status=down" className={`readout ${s.monitors.down ? 'alert' : ''}`}>
          <div className="label">Down</div>
          <div className="value">{s.monitors.down}</div>
          <div className="hint">
            {s.monitors.up} up · {s.monitors.unknown} pending · {s.monitors.paused} paused
          </div>
        </Link>
        <Link to="/drift" className={`readout ${s.openDrift.breaking ? 'alert' : ''}`}>
          <div className="label">Breaking drift</div>
          <div className="value">{s.openDrift.breaking}</div>
          <div className="hint">
            {s.openDrift.warning} warning · {s.openDrift.info} info open
          </div>
        </Link>
        <Link to="/incidents" className={`readout ${s.openIncidents ? 'alert' : ''}`}>
          <div className="label">Open incidents</div>
          <div className="value">{s.openIncidents}</div>
          <div className="hint">consecutive-failure threshold</div>
        </Link>
        <div className="readout">
          <div className="label">Checks · 24 h</div>
          <div className="value">{s.checksLast24h.total}</div>
          <div className="hint">{failRate}% failed</div>
        </div>
      </section>

      <div className="grid-2" style={{ marginBottom: 18 }}>
        <section className="panel">
          <div className="panel-head">
            <h2>Open drift</h2>
            <Link to="/drift" className="btn small ghost">
              Inbox →
            </Link>
          </div>
          {drift.data?.events.length ? (
            <table>
              <tbody>
                {drift.data.events.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => nav(`/monitors/${e.monitorId}`)}>
                    <td>
                      <div className="cell-title">{e.monitorName}</div>
                      <div className="cell-sub">{e.changes[0]?.message}</div>
                    </td>
                    <td>
                      <SeverityBadge severity={e.severity} />
                    </td>
                    <td className="num cell-sub">{ago(e.detectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No open drift">Every locked baseline matches what upstreams return.</Empty>
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Open incidents</h2>
            <Link to="/incidents" className="btn small ghost">
              All →
            </Link>
          </div>
          {incidents.data?.incidents.length ? (
            <table>
              <tbody>
                {incidents.data.incidents.map((i) => (
                  <tr key={i.id} className="clickable" onClick={() => nav(`/monitors/${i.monitorId}`)}>
                    <td>
                      <div className="cell-title">{i.monitorName}</div>
                      <div className="cell-sub">{i.lastError ?? i.cause}</div>
                    </td>
                    <td className="num cell-sub">since {ago(i.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No open incidents">Nothing is failing repeatedly right now.</Empty>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Monitors</h2>
          <Link to="/monitors" className="btn small ghost">
            Manage →
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Monitor</th>
                <th className="hide-sm">Latency trace</th>
                <th className="num">Last</th>
                <th className="num">Checked</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => nav(`/monitors/${m.id}`)}>
                  <td>
                    <StatusBadge status={m.status} enabled={m.enabled} />
                  </td>
                  <td>
                    <div className="cell-title">
                      {m.name} {m.openDrift.worst ? <SeverityBadge severity={m.openDrift.worst} /> : null}
                    </div>
                    <div className="cell-sub mono">{targetOf(m.config)}</div>
                  </td>
                  <td className="hide-sm">
                    <Sparkline points={m.recent} />
                  </td>
                  <td className="num mono">{duration(m.lastDurationMs)}</td>
                  <td className="num cell-sub">{ago(m.lastCheckedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
