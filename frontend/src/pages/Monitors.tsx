import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, type MonitorListItem, qs } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorNote, Loading, PageHead, SeverityBadge, Sparkline, StatusBadge } from '../components/ui';
import { ago, duration, interval, targetOf } from '../format';

const KIND_LABEL = { http: 'HTTP', llm: 'LLM', mcp: 'MCP' } as const;

export function MonitorsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = {
    q: params.get('q') ?? '',
    kind: params.get('kind') ?? '',
    status: params.get('status') ?? '',
    tag: params.get('tag') ?? '',
  };
  const query = useQuery({
    queryKey: ['monitors', filters],
    queryFn: () => api.get<{ monitors: MonitorListItem[] }>(`/monitors${qs(filters)}`),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const list = query.data?.monitors ?? [];
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHead
        eyebrow="Monitors"
        title="Watched dependencies"
        sub="REST APIs, LLM endpoints and MCP servers, probed on a schedule."
        actions={
          can('editor') ? (
            <Link className="btn primary" to="/monitors/new">
              New monitor
            </Link>
          ) : null
        }
      />
      <section className="panel">
        <div className="filters" role="search">
          <input
            aria-label="Search by name or URL"
            placeholder="Search name or URL…"
            value={filters.q}
            onChange={(e) => set('q', e.target.value)}
          />
          <select aria-label="Kind" value={filters.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="">All kinds</option>
            <option value="http">HTTP</option>
            <option value="llm">LLM</option>
            <option value="mcp">MCP</option>
          </select>
          <select aria-label="Status" value={filters.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Any status</option>
            <option value="up">Up</option>
            <option value="down">Down</option>
            <option value="unknown">Pending</option>
          </select>
          <input
            aria-label="Tag"
            placeholder="Tag"
            value={filters.tag}
            onChange={(e) => set('tag', e.target.value.trim())}
            style={{ maxWidth: 140 }}
          />
          {filtered ? (
            <button className="btn ghost small" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </button>
          ) : null}
        </div>
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <div className="panel-body">
            <ErrorNote error={query.error} retry={() => query.refetch()} />
          </div>
        ) : list.length === 0 ? (
          filtered ? (
            <Empty title="No monitors match">Try different filters.</Empty>
          ) : (
            <Empty
              title="No monitors yet"
              action={
                can('editor') ? (
                  <Link className="btn primary" to="/monitors/new">
                    Create the first one
                  </Link>
                ) : null
              }
            >
              A monitor probes one dependency and learns what its responses look like.
            </Empty>
          )
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Monitor</th>
                  <th>Kind</th>
                  <th>Drift</th>
                  <th className="hide-sm">Latency trace</th>
                  <th className="num">Every</th>
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
                      <Link
                        to={`/monitors/${m.id}`}
                        className="cell-title"
                        style={{ textDecoration: 'none' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {m.name}
                      </Link>
                      <div className="cell-sub mono">{targetOf(m.config)}</div>
                      <div style={{ marginTop: 3 }}>
                        {m.tags.map((t) => (
                          <span className="tag" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className="badge outline">{KIND_LABEL[m.kind]}</span>
                    </td>
                    <td>{m.openDrift.worst ? <SeverityBadge severity={m.openDrift.worst} /> : <span className="cell-sub">—</span>}</td>
                    <td className="hide-sm">
                      <Sparkline points={m.recent} />
                      <div className="cell-sub mono">{duration(m.lastDurationMs)}</div>
                    </td>
                    <td className="num mono">{interval(m.intervalSeconds)}</td>
                    <td className="num cell-sub">{ago(m.lastCheckedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
