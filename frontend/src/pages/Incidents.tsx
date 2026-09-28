import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api, type Incident, qs } from '../api';
import { Empty, ErrorNote, Loading, PageHead } from '../components/ui';
import { ago, dateTime } from '../format';

function length(i: Incident) {
  const ms = new Date(i.resolvedAt ?? Date.now()).getTime() - new Date(i.openedAt).getTime();
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}

export function IncidentTable({ incidents, showMonitor = true }: { incidents: Incident[]; showMonitor?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>State</th>
            {showMonitor ? <th>Monitor</th> : null}
            <th>Cause</th>
            <th className="num">Opened</th>
            <th className="num">Duration</th>
            <th className="num">Failures</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => (
            <tr key={i.id}>
              <td>{i.resolvedAt ? <span className="badge up">resolved</span> : <span className="badge down">open</span>}</td>
              {showMonitor ? (
                <td>
                  <Link to={`/monitors/${i.monitorId}`} className="cell-title">
                    {i.monitorName}
                  </Link>
                </td>
              ) : null}
              <td>
                <div className="cell-sub mono" style={{ whiteSpace: 'normal' }}>
                  {i.cause}
                </div>
              </td>
              <td className="num cell-sub" title={dateTime(i.openedAt)}>
                {ago(i.openedAt)}
              </td>
              <td className="num mono">{length(i)}</td>
              <td className="num mono">{i.failureCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IncidentsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const q = useQuery({
    queryKey: ['incidents', status || 'all'],
    queryFn: () => api.get<{ incidents: Incident[] }>(`/incidents${qs({ status, limit: 100 })}`),
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHead
        eyebrow="Incidents"
        title="Availability incidents"
        sub="Opened after a monitor fails its consecutive-failure threshold; resolved by the next success."
      />
      <div className="tabs" role="tablist">
        {[
          ['', 'All'],
          ['open', 'Open'],
          ['resolved', 'Resolved'],
        ].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={status === v} onClick={() => setParams(v ? { status: v! } : {}, { replace: true })}>
            {l}
          </button>
        ))}
      </div>
      <section className="panel">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div className="panel-body">
            <ErrorNote error={q.error} retry={() => q.refetch()} />
          </div>
        ) : q.data!.incidents.length === 0 ? (
          <Empty title="No incidents">Nothing has failed past its threshold.</Empty>
        ) : (
          <IncidentTable incidents={q.data!.incidents} />
        )}
      </section>
    </>
  );
}
