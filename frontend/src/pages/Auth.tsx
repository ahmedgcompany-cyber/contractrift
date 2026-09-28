import { type FormEvent, type ReactNode, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { Logo } from '../components/Layout';
import { ErrorNote, Field, Loading, Spinner } from '../components/ui';

function AuthCard({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-card panel">
        <div className="panel-body">
          <div className="brand">
            <Logo />
            <div>
              <div className="brand-name">ContractRift</div>
              <div className="brand-tag">dependency drift monitor</div>
            </div>
          </div>
          <h1 style={{ fontSize: '1.3rem' }}>{title}</h1>
          <p className="sub" style={{ color: 'var(--ink-3)', marginTop: 4 }}>
            {sub}
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}

export function SetupPage() {
  const { needsSetup, setupTokenRequired, loading, refresh } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', setupToken: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (!needsSetup) return <Navigate to="/login" replace />;
  const mismatch = form.confirm.length > 0 && form.password !== form.confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/setup', {
        name: form.name,
        email: form.email,
        password: form.password,
        ...(setupTokenRequired ? { setupToken: form.setupToken } : {}),
      });
      await refresh();
      nav('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Create the administrator account" sub="This runs once. Later users are invited by an administrator.">
      <form onSubmit={submit} style={{ marginTop: 16 }}>
        {error ? <ErrorNote error={error} /> : null}
        {setupTokenRequired ? (
          <Field label="Setup token" help="Set by SETUP_TOKEN on the server (for example in your hosting dashboard).">
            <input
              required
              type="password"
              autoComplete="off"
              value={form.setupToken}
              onChange={(e) => setForm({ ...form, setupToken: e.target.value })}
            />
          </Field>
        ) : null}
        <Field label="Name">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
        </Field>
        <Field label="Email">
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="email"
          />
        </Field>
        <Field label="Password" help="At least 10 characters.">
          <input
            required
            minLength={10}
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm password" error={mismatch ? 'Passwords do not match.' : undefined}>
          <input
            required
            type="password"
            aria-invalid={mismatch}
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <button className="btn primary" disabled={busy || mismatch}>
          {busy ? <Spinner /> : null} Create account
        </button>
      </form>
    </AuthCard>
  );
}

export function LoginPage() {
  const { user, needsSetup, loading, refresh, demo } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to={loc.state?.from ?? '/'} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', form);
      await refresh();
      nav(loc.state?.from ?? '/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Sign in" sub="Know when your upstreams change — before your users do.">
      <form onSubmit={submit} style={{ marginTop: 16 }}>
        {demo ? (
          <div className="note">
            <strong>Public demo.</strong> Read-only account: <code>{demo.email}</code> / <code>{demo.password}</code>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn small" onClick={() => setForm({ email: demo.email, password: demo.password })}>
                Fill in demo account
              </button>
            </div>
          </div>
        ) : null}
        {error ? <ErrorNote error={error} /> : null}
        <Field label="Email">
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            autoComplete="username"
            autoFocus
          />
        </Field>
        <Field label="Password">
          <input
            required
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="current-password"
          />
        </Field>
        <button className="btn primary" disabled={busy}>
          {busy ? <Spinner /> : null} Sign in
        </button>
        <p className="help" style={{ color: 'var(--ink-3)', fontSize: '0.8rem', margin: 0 }}>
          Forgot your password? Ask an administrator to reset it.
        </p>
      </form>
    </AuthCard>
  );
}

export function ChangePasswordPage() {
  const { user, loading, refresh } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  const mismatch = form.confirm.length > 0 && form.newPassword !== form.confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      await refresh();
      nav('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthCard title="Choose a new password" sub="Your account uses a temporary password. Set your own to continue.">
      <form onSubmit={submit} style={{ marginTop: 16 }}>
        {error ? <ErrorNote error={error} /> : null}
        <Field label="Current (temporary) password">
          <input
            required
            type="password"
            value={form.currentPassword}
            onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            autoComplete="current-password"
          />
        </Field>
        <Field label="New password" help="At least 10 characters.">
          <input
            required
            minLength={10}
            type="password"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}>
          <input
            required
            type="password"
            aria-invalid={mismatch}
            value={form.confirm}
            onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <button className="btn primary" disabled={busy || mismatch}>
          {busy ? <Spinner /> : null} Save password
        </button>
      </form>
    </AuthCard>
  );
}
