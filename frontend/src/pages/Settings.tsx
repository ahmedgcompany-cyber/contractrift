import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
import { api, type ApiToken, type AuditEntry, type Channel, type Delivery, type EventType, type Role, type User } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorNote, errorText, Field, Loading, PageHead, Spinner, useConfirm, useToast } from '../components/ui';
import { ago, dateTime } from '../format';

const EVENTS: [EventType, string][] = [
  ['incident.opened', 'Incident opened'],
  ['incident.resolved', 'Incident resolved'],
  ['drift.breaking', 'Breaking drift'],
  ['drift.warning', 'Warning drift'],
  ['drift.info', 'Info drift'],
];

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { can } = useAuth();
  return can('admin') ? <>{children}</> : <Navigate to="/" replace />;
}

// ---------------- channels ----------------
function Deliveries({ channelId }: { channelId: string }) {
  const q = useQuery({
    queryKey: ['deliveries', channelId],
    queryFn: () => api.get<{ deliveries: Delivery[] }>(`/channels/${channelId}/deliveries?limit=20`),
  });
  if (q.isLoading) return <Loading />;
  if (!q.data?.deliveries.length) return <p className="cell-sub">No deliveries yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Event</th>
          <th>Status</th>
          <th className="num">Attempts</th>
          <th>Detail</th>
          <th className="num">When</th>
        </tr>
      </thead>
      <tbody>
        {q.data.deliveries.map((d) => (
          <tr key={d.id}>
            <td className="mono">{d.eventType}</td>
            <td>
              <span className={`badge ${d.status === 'sent' ? 'up' : d.status}`}>{d.status}</span>
            </td>
            <td className="num mono">{d.attempts}</td>
            <td className="cell-sub">{d.lastError ?? (d.responseStatus ? `HTTP ${d.responseStatus}` : '')}</td>
            <td className="num cell-sub">{ago(d.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChannelForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: '',
    kind: 'webhook' as 'webhook' | 'slack',
    url: '',
    secret: '',
    events: ['incident.opened', 'incident.resolved', 'drift.breaking', 'drift.warning'] as EventType[],
  });
  const create = useMutation({
    mutationFn: () =>
      api.post('/channels', {
        name: f.name,
        kind: f.kind,
        url: f.url,
        events: f.events,
        ...(f.secret && f.kind === 'webhook' ? { secret: f.secret } : {}),
      }),
    onSuccess: () => {
      toast('Channel added. Use “Send test” to verify it.');
      void qc.invalidateQueries({ queryKey: ['channels'] });
      onDone();
    },
  });
  return (
    <form
      className="panel-body stack"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      {create.error ? <ErrorNote error={create.error} /> : null}
      <div className="form-grid">
        <Field label="Name">
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="#ops-alerts" />
        </Field>
        <Field label="Type">
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'webhook' | 'slack' })}>
            <option value="webhook">Generic webhook (JSON)</option>
            <option value="slack">Slack incoming webhook</option>
          </select>
        </Field>
        <Field label="URL" className="span-2" help="Stored encrypted; only the host is shown afterwards.">
          <input required type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        </Field>
        {f.kind === 'webhook' ? (
          <Field
            label="Signing secret (optional)"
            className="span-2"
            help="Adds X-Tripline-Signature: sha256=HMAC(secret, timestamp + '.' + body)."
          >
            <input
              type="password"
              autoComplete="off"
              minLength={8}
              value={f.secret}
              onChange={(e) => setF({ ...f, secret: e.target.value })}
            />
          </Field>
        ) : null}
        <fieldset className="span-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label-text">Send these events</legend>
          <div className="actions" style={{ marginTop: 6 }}>
            {EVENTS.map(([e, l]) => (
              <label className="check" key={e}>
                <input
                  type="checkbox"
                  checked={f.events.includes(e)}
                  onChange={(ev) => setF({ ...f, events: ev.target.checked ? [...f.events, e] : f.events.filter((x) => x !== e) })}
                />{' '}
                {l}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="actions">
        <button className="btn primary" disabled={create.isPending || f.events.length === 0}>
          {create.isPending ? <Spinner /> : null} Add channel
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ChannelsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['channels'], queryFn: () => api.get<{ channels: Channel[] }>('/channels') });
  const test = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; status?: number; error?: string }>(`/channels/${id}/test`),
    onSuccess: (r, id) => {
      toast(r.ok ? `Test delivered (HTTP ${r.status}).` : `Test failed: ${r.error}`, r.ok ? 'ok' : 'error');
      void qc.invalidateQueries({ queryKey: ['deliveries', id] });
    },
    onError: (err) => toast(errorText(err), 'error'),
  });
  const toggle = useMutation({
    mutationFn: (c: Channel) => api.patch(`/channels/${c.id}`, { enabled: !c.enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
    onError: (err) => toast(errorText(err), 'error'),
  });
  return (
    <AdminOnly>
      <PageHead
        eyebrow="Settings"
        title="Notifications"
        sub="Incidents and drift are delivered to every enabled channel subscribed to the event, with retries."
        actions={
          !adding ? (
            <button className="btn primary" onClick={() => setAdding(true)}>
              Add channel
            </button>
          ) : null
        }
      />
      {confirm.dialog}
      <div className="stack">
        {adding ? (
          <section className="panel">
            <div className="panel-head">
              <h2>New channel</h2>
            </div>
            <ChannelForm onDone={() => setAdding(false)} />
          </section>
        ) : null}
        <section className="panel">
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <div className="panel-body">
              <ErrorNote error={q.error} />
            </div>
          ) : !q.data!.channels.length ? (
            <Empty title="No channels">Without a channel, incidents and drift only appear in this UI.</Empty>
          ) : (
            q.data!.channels.map((c) => (
              <div key={c.id} className="drift-card">
                <header>
                  <div>
                    <div className="cell-title">
                      {c.name} <span className="badge outline">{c.kind}</span> {!c.enabled ? <span className="badge">disabled</span> : null}
                    </div>
                    <div className="cell-sub mono">
                      {c.target}
                      {c.hasSecret ? ' · signed' : ''} · {c.events.join(', ')}
                    </div>
                  </div>
                  <div className="actions">
                    <button className="btn small" onClick={() => test.mutate(c.id)} disabled={test.isPending}>
                      Send test
                    </button>
                    <button className="btn small" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                      Deliveries
                    </button>
                    <button className="btn small" onClick={() => toggle.mutate(c)}>
                      {c.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      className="btn small danger"
                      onClick={() =>
                        confirm.ask({
                          title: `Delete channel “${c.name}”?`,
                          body: 'Pending deliveries to it are discarded.',
                          confirmLabel: 'Delete',
                          danger: true,
                          action: async () => {
                            await api.del(`/channels/${c.id}`);
                            void qc.invalidateQueries({ queryKey: ['channels'] });
                          },
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                </header>
                {open === c.id ? <Deliveries channelId={c.id} /> : null}
              </div>
            ))
          )}
        </section>
      </div>
    </AdminOnly>
  );
}

// ---------------- users ----------------
export function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [f, setF] = useState({ name: '', email: '', role: 'viewer' as Role, password: '' });
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: User[] }>('/users') });
  const create = useMutation({
    mutationFn: () => api.post('/users', f),
    onSuccess: () => {
      toast('User created. Share the initial password securely; they must change it at first sign-in.');
      setF({ name: '', email: '', role: 'viewer', password: '' });
      setAdding(false);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<User> }) => api.patch(`/users/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) => toast(errorText(err), 'error'),
  });

  return (
    <AdminOnly>
      <PageHead
        eyebrow="Settings"
        title="Users"
        sub="Viewers read; editors manage monitors and decide on drift; admins manage users, channels and the audit log."
        actions={
          !adding ? (
            <button className="btn primary" onClick={() => setAdding(true)}>
              Add user
            </button>
          ) : null
        }
      />
      {confirm.dialog}
      <div className="stack">
        {temp ? (
          <div className="note warn" role="alert">
            Temporary password for <strong>{temp.email}</strong> (shown once):
            <div className="secret-token" style={{ marginTop: 6 }}>
              {temp.password}
            </div>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => setTemp(null)}>
              Done
            </button>
          </div>
        ) : null}
        {adding ? (
          <section className="panel">
            <div className="panel-head">
              <h2>New user</h2>
            </div>
            <form
              className="panel-body stack"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              {create.error ? <ErrorNote error={create.error} /> : null}
              <div className="form-grid">
                <Field label="Name">
                  <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </Field>
                <Field label="Email">
                  <input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                </Field>
                <Field label="Role">
                  <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                </Field>
                <Field label="Initial password" help="At least 10 characters. They must change it at first sign-in.">
                  <input
                    required
                    minLength={10}
                    type="password"
                    autoComplete="new-password"
                    value={f.password}
                    onChange={(e) => setF({ ...f, password: e.target.value })}
                  />
                </Field>
              </div>
              <div className="actions">
                <button className="btn primary" disabled={create.isPending}>
                  {create.isPending ? <Spinner /> : null} Create user
                </button>
                <button type="button" className="btn ghost" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        ) : null}
        <section className="panel">
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <div className="panel-body">
              <ErrorNote error={q.error} />
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>State</th>
                    <th className="num">Last sign-in</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {q.data!.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="cell-title">
                          {u.name} {u.id === me?.id ? <span className="badge outline">you</span> : null}
                        </div>
                        <div className="cell-sub">{u.email}</div>
                      </td>
                      <td>
                        <select
                          aria-label={`Role of ${u.email}`}
                          value={u.role}
                          onChange={(e) => update.mutate({ id: u.id, patch: { role: e.target.value as Role } })}
                          style={{ width: 'auto' }}
                        >
                          <option value="viewer">viewer</option>
                          <option value="editor">editor</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td>
                        {u.disabled ? (
                          <span className="badge down">disabled</span>
                        ) : u.mustChangePassword ? (
                          <span className="badge warning">must change password</span>
                        ) : (
                          <span className="badge up">active</span>
                        )}
                      </td>
                      <td className="num cell-sub">{ago(u.lastLoginAt)}</td>
                      <td className="num">
                        {u.id !== me?.id ? (
                          <div className="actions" style={{ justifyContent: 'flex-end' }}>
                            <button
                              className="btn small"
                              onClick={() =>
                                confirm.ask({
                                  title: `Reset password for ${u.email}?`,
                                  body: 'A temporary password is generated and shown once. The user is signed out everywhere.',
                                  confirmLabel: 'Reset password',
                                  action: async () => {
                                    const r = await api.post<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`);
                                    setTemp({ email: u.email, password: r.temporaryPassword });
                                    void qc.invalidateQueries({ queryKey: ['users'] });
                                  },
                                })
                              }
                            >
                              Reset password
                            </button>
                            <button className="btn small" onClick={() => update.mutate({ id: u.id, patch: { disabled: !u.disabled } })}>
                              {u.disabled ? 'Enable' : 'Disable'}
                            </button>
                            <button
                              className="btn small danger"
                              onClick={() =>
                                confirm.ask({
                                  title: `Delete ${u.email}?`,
                                  body: 'Their sessions and API tokens are deleted. Audit entries are kept.',
                                  confirmLabel: 'Delete user',
                                  danger: true,
                                  action: async () => {
                                    await api.del(`/users/${u.id}`);
                                    void qc.invalidateQueries({ queryKey: ['users'] });
                                  },
                                })
                              }
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminOnly>
  );
}

// ---------------- tokens ----------------
export function TokensPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [days, setDays] = useState('90');
  const [created, setCreated] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['tokens'], queryFn: () => api.get<{ tokens: ApiToken[] }>('/tokens') });
  const create = useMutation({
    mutationFn: () => api.post<{ token: string }>('/tokens', { name, ...(days ? { expiresInDays: Number(days) } : {}) }),
    onSuccess: (r) => {
      setCreated(r.token);
      setName('');
      void qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });
  const origin = window.location.origin;
  return (
    <>
      <PageHead
        eyebrow="Settings"
        title="API tokens"
        sub="Read-only bearer tokens for CI gates and scripts. They carry your role for reads and cannot change anything."
      />
      {confirm.dialog}
      <div className="stack">
        {created ? (
          <div className="note warn" role="alert">
            Copy this token now — it is not shown again.
            <div className="secret-token" style={{ marginTop: 6 }}>
              {created}
            </div>
            <div className="cell-sub" style={{ marginTop: 8 }}>
              CI gate example:
            </div>
            <pre className="excerpt">{`TRIPLINE_URL=${origin} TRIPLINE_TOKEN=<token> node scripts/tripline-gate.mjs --tags payments`}</pre>
            <button className="btn small" style={{ marginTop: 8 }} onClick={() => setCreated(null)}>
              I’ve stored it
            </button>
          </div>
        ) : null}
        <section className="panel">
          <form
            className="panel-body actions"
            style={{ alignItems: 'flex-end' }}
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Token name">
              <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="github-actions" />
            </Field>
            <Field label="Expires in">
              <select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
                <option value="">Never</option>
              </select>
            </Field>
            <button className="btn primary" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : null} Create token
            </button>
          </form>
          {create.error ? (
            <div className="panel-body">
              <ErrorNote error={create.error} />
            </div>
          ) : null}
        </section>
        <section className="panel">
          {q.isLoading ? (
            <Loading />
          ) : !q.data?.tokens.length ? (
            <Empty title="No tokens" />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th className="num">Last used</th>
                  <th className="num">Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {q.data.tokens.map((t) => (
                  <tr key={t.id}>
                    <td className="cell-title">{t.name}</td>
                    <td className="mono">{t.prefix}…</td>
                    <td className="num cell-sub">{ago(t.lastUsedAt)}</td>
                    <td className="num cell-sub">{t.expiresAt ? dateTime(t.expiresAt) : 'never'}</td>
                    <td className="num">
                      <button
                        className="btn small danger"
                        onClick={() =>
                          confirm.ask({
                            title: `Revoke “${t.name}”?`,
                            body: 'Anything using this token stops working immediately.',
                            confirmLabel: 'Revoke',
                            danger: true,
                            action: async () => {
                              await api.del(`/tokens/${t.id}`);
                              void qc.invalidateQueries({ queryKey: ['tokens'] });
                            },
                          })
                        }
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

// ---------------- audit ----------------
export function AuditPage() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.get<{ entries: AuditEntry[] }>('/audit?limit=200') });
  return (
    <AdminOnly>
      <PageHead eyebrow="Settings" title="Audit log" sub="Security-relevant actions. Secret values are never recorded." />
      <section className="panel">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <div className="panel-body">
            <ErrorNote error={q.error} />
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {q.data!.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="cell-sub" title={dateTime(e.createdAt)}>
                      {ago(e.createdAt)}
                    </td>
                    <td>
                      {e.userEmail ?? <span className="cell-sub">—</span>}
                      <div className="cell-sub mono">{e.ip}</div>
                    </td>
                    <td className="mono">{e.action}</td>
                    <td className="cell-sub mono">{e.targetType ? `${e.targetType} ${e.targetId?.slice(0, 8) ?? ''}` : '—'}</td>
                    <td className="cell-sub mono" style={{ whiteSpace: 'normal', maxWidth: 360 }}>
                      {Object.keys(e.details).length ? JSON.stringify(e.details) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminOnly>
  );
}

// ---------------- account ----------------
export function AccountPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: f.currentPassword, newPassword: f.newPassword }),
    onSuccess: () => {
      toast('Password changed. Other sessions were signed out.');
      setF({ currentPassword: '', newPassword: '', confirm: '' });
    },
  });
  const mismatch = f.confirm.length > 0 && f.confirm !== f.newPassword;
  return (
    <>
      <PageHead eyebrow="Settings" title="Account" sub={`${user?.email} · ${user?.role}`} />
      <section className="panel" style={{ maxWidth: 520 }}>
        <div className="panel-head">
          <h2>Change password</h2>
        </div>
        <form
          className="panel-body stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch) change.mutate();
          }}
        >
          {change.error ? <ErrorNote error={change.error} /> : null}
          <Field label="Current password">
            <input
              required
              type="password"
              autoComplete="current-password"
              value={f.currentPassword}
              onChange={(e) => setF({ ...f, currentPassword: e.target.value })}
            />
          </Field>
          <Field label="New password" help="At least 10 characters.">
            <input
              required
              minLength={10}
              type="password"
              autoComplete="new-password"
              value={f.newPassword}
              onChange={(e) => setF({ ...f, newPassword: e.target.value })}
            />
          </Field>
          <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}>
            <input
              required
              type="password"
              autoComplete="new-password"
              aria-invalid={mismatch}
              value={f.confirm}
              onChange={(e) => setF({ ...f, confirm: e.target.value })}
            />
          </Field>
          <div>
            <button className="btn primary" disabled={change.isPending || mismatch}>
              {change.isPending ? <Spinner /> : null} Change password
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
