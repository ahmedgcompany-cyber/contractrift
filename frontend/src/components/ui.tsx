import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ApiError, type Severity, type Status } from '../api';

// ---------- toasts ----------
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

// ---------- confirm dialog ----------
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} onCancel={props.onCancel} aria-labelledby="confirm-title">
      <div className="panel-body">
        <h2 id="confirm-title">{props.title}</h2>
        <p>{props.body}</p>
      </div>
      <div className="dialog-actions">
        <button className="btn ghost" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </button>
        <button className={`btn ${props.danger ? 'danger solid' : 'primary'}`} onClick={props.onConfirm} disabled={props.busy}>
          {props.busy ? <Spinner /> : null}
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

/** Hook wrapping ConfirmDialog state: `ask(opts)` opens it, the dialog element is `dialog`. */
export function useConfirm() {
  const [state, setState] = useState<null | {
    title: string;
    body: ReactNode;
    confirmLabel: string;
    danger?: boolean;
    action: () => Promise<unknown>;
  }>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dialog = (
    <ConfirmDialog
      open={!!state}
      title={state?.title ?? ''}
      body={state?.body ?? ''}
      confirmLabel={state?.confirmLabel ?? 'Confirm'}
      danger={state?.danger}
      busy={busy}
      onCancel={() => setState(null)}
      onConfirm={async () => {
        if (!state) return;
        setBusy(true);
        try {
          await state.action();
          setState(null);
        } catch (err) {
          toast(errorText(err), 'error');
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { ask: setState, dialog };
}

// ---------- small pieces ----------
export const Spinner = () => <span className="spinner" aria-hidden="true" />;

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNote({ error, retry }: { error: unknown; retry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  return (
    <div className="note error" role="alert">
      <strong>{e?.status === 403 ? 'Not allowed. ' : ''}</strong>
      {errorText(error)}
      {e?.details?.length ? (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {e.details.map((d, i) => (
            <li key={i}>
              <code>{d.path}</code> {d.message}
            </li>
          ))}
        </ul>
      ) : null}
      {e?.requestId ? <span className="rid">request id {e.requestId}</span> : null}
      {retry ? (
        <button className="btn small" style={{ marginTop: 8 }} onClick={retry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <svg width="64" height="24" viewBox="0 0 64 24" aria-hidden="true">
        <path d="M0 12h22l4-8 5 16 4-8h29" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function StatusBadge({ status, enabled = true }: { status: Status; enabled?: boolean }) {
  if (!enabled)
    return (
      <span className="badge outline">
        <span className="dot paused" /> paused
      </span>
    );
  const label = status === 'unknown' ? 'pending' : status;
  return (
    <span className={`badge ${status}`}>
      <span className={`dot ${status}`} /> {label}
    </span>
  );
}

export const SeverityBadge = ({ severity }: { severity: Severity }) => <span className={`badge ${severity}`}>{severity}</span>;

/** Seismograph-style latency trace; failed checks drawn as red ticks. */
export function Sparkline({ points, width = 140, height = 28 }: { points: { d: number; ok: boolean }[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="cell-sub">not enough data</span>;
  const max = Math.max(...points.map((p) => p.d), 1);
  const step = width / (points.length - 1);
  const y = (d: number) => height - 3 - (d / max) * (height - 6);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${y(p.d).toFixed(1)}`).join('');
  return (
    <svg
      className="spark"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Latency of last ${points.length} checks, max ${max} ms`}
    >
      <path d={path} fill="none" stroke="var(--ink-2)" strokeWidth="1.3" strokeLinejoin="round" />
      {points.map((p, i) =>
        p.ok ? null : <line key={i} x1={i * step} x2={i * step} y1={0} y2={height} stroke="var(--down)" strokeWidth="2" />,
      )}
    </svg>
  );
}

export function PageHead({ eyebrow, title, sub, actions }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </header>
  );
}

/** Labelled form control. The single child element receives `id` and `aria-describedby`. */
export function Field({
  label,
  help,
  error,
  children,
  className,
}: {
  label: string;
  help?: ReactNode;
  error?: string;
  children: ReactElement;
  className?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        ...(error || help ? { 'aria-describedby': noteId } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })
    : children;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id} className="label-text">
        {label}
      </label>
      {control}
      {error ? (
        <div className="err" id={noteId}>
          {error}
        </div>
      ) : help ? (
        <div className="help" id={noteId}>
          {help}
        </div>
      ) : null}
    </div>
  );
}
