import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { api, type DriftChange, type DriftEvent, qs } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorNote, errorText, Loading, PageHead, SeverityBadge, Spinner, useToast } from '../components/ui';
import { ago, dateTime } from '../format';

export function ChangeList({ changes }: { changes: DriftChange[] }) {
  return (
    <ul className="changes">
      {changes.map((c, i) => (
        <li key={i} className={c.severity}>
          <span className="kind">{c.kind.replace('_', ' ')}</span>
          <span>
            <span className="path">{c.path}</span>
            {c.before !== undefined || c.after !== undefined ? (
              <>
                {'  '}
                {c.before !== undefined ? <del>{c.before}</del> : null}
                {c.before !== undefined && c.after !== undefined ? ' → ' : ''}
                {c.after !== undefined ? <ins>{c.after}</ins> : null}
              </>
            ) : null}
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink-3)', marginTop: 2 }}>{c.message}</div>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DriftCard({ event, showMonitor = true }: { event: DriftEvent; showMonitor?: boolean }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const decide = useMutation({
    mutationFn: (action: 'accept' | 'dismiss') => api.post<{ event: DriftEvent }>(`/drift/${event.id}/${action}`),
    onSuccess: (_d, action) => {
      toast(action === 'accept' ? 'Accepted — the baseline now matches this structure.' : 'Dismissed — this exact change is muted.');
      void qc.invalidateQueries({ queryKey: ['drift'] });
      void qc.invalidateQueries({ queryKey: ['summary'] });
      void qc.invalidateQueries({ queryKey: ['monitors'] });
      void qc.invalidateQueries({ queryKey: ['baseline', event.monitorId] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  return (
    <article className="drift-card" aria-label={`Drift on ${event.monitorName}`}>
      <header>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <SeverityBadge severity={event.severity} />
          {showMonitor ? (
            <Link to={`/monitors/${event.monitorId}`} className="cell-title">
              {event.monitorName}
            </Link>
          ) : null}
          <span className="cell-sub" title={dateTime(event.detectedAt)}>
            detected {ago(event.detectedAt)}
            {event.occurrences > 1 ? ` · seen ${event.occurrences}× (last ${ago(event.lastSeenAt)})` : ''}
          </span>
        </div>
        {event.status === 'open' && can('editor') ? (
          <div className="actions">
            <button
              className="btn small"
              disabled={decide.isPending}
              onClick={() => decide.mutate('dismiss')}
              title="Mute this exact set of changes"
            >
              Dismiss
            </button>
            <button
              className="btn small primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate('accept')}
              title="Make this the new baseline"
            >
              {decide.isPending ? <Spinner /> : null} Accept as baseline
            </button>
          </div>
        ) : (
          <span className="badge outline">{event.status}</span>
        )}
      </header>
      <ChangeList changes={event.changes} />
    </article>
  );
}

export function DriftPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'open';
  const q = useQuery({
    queryKey: ['drift', status],
    queryFn: () => api.get<{ events: DriftEvent[] }>(`/drift${qs({ status: status === 'all' ? undefined : status, limit: 100 })}`),
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHead
        eyebrow="Drift inbox"
        title="Upstream changes"
        sub="Structural differences between what dependencies return now and their learned baseline."
      />
      <div className="tabs" role="tablist">
        {['open', 'accepted', 'dismissed', 'all'].map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => setParams({ status: s }, { replace: true })}>
            {s[0]!.toUpperCase() + s.slice(1)}
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
        ) : q.data!.events.length === 0 ? (
          <Empty title={status === 'open' ? 'Inbox zero' : 'Nothing here'}>
            {status === 'open'
              ? 'No unreviewed changes. New drift appears here and is sent to your notification channels.'
              : 'No drift events with this status.'}
          </Empty>
        ) : (
          q.data!.events.map((e) => <DriftCard key={e.id} event={e} />)
        )}
      </section>
    </>
  );
}
