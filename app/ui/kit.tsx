/**
 * KitBundle admin component kit — lightweight replacements for Polaris,
 * styled by app/ui/kb.css (FAQ Panel design language). Plain React + Remix;
 * no Polaris dependency, so migrated pages stop pulling it in.
 */
import { Link, useLocation, useNavigation } from "@remix-run/react";
import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

const cx = (...c: Array<string | false | null | undefined>) =>
  c.filter(Boolean).join(" ");
const vars = (v: Record<string, string | number>) => v as CSSProperties;

/* ---------------- Shell + navigation ---------------- */

export type TabItem = { label: string; to: string };

/**
 * Page frame: the same centred container on every page, a header with the
 * section name and its tabs, and a thin progress bar while data loads.
 */
export function Shell({
  section,
  tabs,
  children,
}: {
  section?: string;
  tabs?: TabItem[];
  children: ReactNode;
}) {
  const nav = useNavigation();
  return (
    <div className="kb">
      {nav.state === "loading" ? <div className="kb-progress" /> : null}
      <div className="kb-app">
        <header className="kb-top">
          <div className="kb-brand">
            KitBundle{section ? <span>· {section}</span> : null}
          </div>
          {tabs ? <Tabs items={tabs} /> : null}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Section tabs. Active = the longest tab path that prefixes the URL. */
export function Tabs({ items }: { items: TabItem[] }) {
  const { pathname } = useLocation();
  const active = items
    .filter((t) => pathname === t.to || pathname.startsWith(`${t.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;
  return (
    <nav className="kb-tabs">
      {items.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          prefetch="intent"
          className={cx("kb-tab", active === t.to && "is-active")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function PageHead({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <>
      {back ? (
        <Link to={back.to} prefetch="intent" className="kb-back">
          ← {back.label}
        </Link>
      ) : null}
      <div className="kb-head">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="kb-head__actions">{actions}</div> : null}
      </div>
    </>
  );
}

/* ---------------- Actions ---------------- */

export function Btn({
  children,
  variant = "default",
  size,
  loading,
  disabled,
  onClick,
  to,
  type = "button",
  title,
}: {
  children: ReactNode;
  variant?: "default" | "primary" | "ghost" | "danger" | "link";
  size?: "tiny";
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  to?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const cls = cx(
    "kb-btn",
    variant !== "default" && `kb-btn--${variant}`,
    size && `kb-btn--${size}`,
  );
  if (to) {
    return (
      <Link to={to} prefetch="intent" className={cls} title={title}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
    >
      {loading ? <span className="kb-spin" /> : null}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="kb-seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={cx(value === o.value && "is-active")}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Containers ---------------- */

export function Panel({
  title,
  actions,
  children,
  flush,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="kb-panel">
      {title || actions ? (
        <div className="kb-panel__head">
          <h2>{title}</h2>
          {actions}
        </div>
      ) : null}
      {flush ? children : <div className="kb-panel__body">{children}</div>}
    </section>
  );
}

export function Stats({
  items,
}: {
  items: { label: string; value: ReactNode; danger?: boolean; to?: string }[];
}) {
  return (
    <div className="kb-stats" style={vars({ "--cols": items.length })}>
      {items.map((s) => {
        const body = (
          <>
            <div className={cx("kb-stat__n", s.danger && "is-danger")}>
              {s.value}
            </div>
            <div className="kb-stat__l">{s.label}</div>
          </>
        );
        return s.to ? (
          <Link key={s.label} to={s.to} prefetch="intent" className="kb-stat kb-stat--link">
            {body}
          </Link>
        ) : (
          <div className="kb-stat" key={s.label}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone?: "danger" | "warn" | "ok";
  children: ReactNode;
}) {
  return <div className={cx("kb-banner", tone && `kb-banner--${tone}`)}>{children}</div>;
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="kb-empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/* ---------------- Lists ---------------- */

/** A list whose header and rows share one CSS grid (`cols` = template). */
export function List({
  cols,
  title,
  head,
  children,
  footer,
}: {
  cols: string;
  title?: ReactNode;
  head?: ReactNode[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="kb-list" style={vars({ "--cols": cols })}>
      {title ? <div className="kb-list__title">{title}</div> : null}
      {head ? (
        <div className="kb-list__head">
          {head.map((h, i) => (
            <span key={i}>{h}</span>
          ))}
        </div>
      ) : null}
      {children}
      {footer}
    </div>
  );
}

/** A list row; with `to` the whole row is a link. */
export function Row({ children, to }: { children: ReactNode; to?: string }) {
  return to ? (
    <Link to={to} prefetch="intent" className="kb-row kb-row--link">
      {children}
    </Link>
  ) : (
    <div className="kb-row">{children}</div>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return (
    <div className="kb-pager">
      <span>{`${from}–${to} of ${total}`}</span>
      <Btn size="tiny" disabled={page === 0} onClick={() => onPage(page - 1)}>
        ‹ Prev
      </Btn>
      <Btn size="tiny" disabled={to >= total} onClick={() => onPage(page + 1)}>
        Next ›
      </Btn>
    </div>
  );
}

/** Shopify CDN images: request a small rendition instead of the original. */
export function sized(src: string | null | undefined, px: number) {
  if (!src) return "";
  if (!/cdn\.shopify\.com|shopify\.com\/s\/files/.test(src)) return src;
  return `${src}${src.includes("?") ? "&" : "?"}width=${px * 2}`;
}

export function Thumb({
  src,
  size = 52,
  alt = "",
}: {
  src?: string | null;
  size?: number;
  alt?: string;
}) {
  return (
    <span className="kb-thumb" style={vars({ "--s": `${size}px` })}>
      {src ? (
        <img src={sized(src, size)} alt={alt} loading="lazy" />
      ) : (
        <svg
          viewBox="0 0 24 24"
          width={Math.round(size * 0.45)}
          height={Math.round(size * 0.45)}
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="#b9bec4" strokeWidth="1.6" />
          <circle cx="9" cy="10" r="1.8" fill="#b9bec4" />
          <path d="M4 18l5-5 4 4 3-3 4 4" fill="none" stroke="#b9bec4" strokeWidth="1.6" />
        </svg>
      )}
    </span>
  );
}

export function Pill({
  tone,
  children,
  to,
  title,
}: {
  tone?: "ok" | "warn" | "info" | "danger";
  children: ReactNode;
  to?: string;
  title?: string;
}) {
  const cls = cx("kb-pill", tone && `kb-pill--${tone}`);
  return to ? (
    <Link to={to} prefetch="intent" className={cls} title={title}>
      {children}
    </Link>
  ) : (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}

/* ---------------- Form controls ---------------- */

export function Field({
  label,
  help,
  children,
}: {
  label?: ReactNode;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="kb-field">
      {label ? <span className="kb-field__label">{label}</span> : null}
      {children}
      {help ? <span className="kb-field__help">{help}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("kb-input", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx("kb-select", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("kb-textarea", props.className)} />;
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="kb-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function Switch({
  label,
  checked,
  onChange,
}: {
  label?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="kb-switch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="kb-switch__track" />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

/* ---------------- Editor helpers ---------------- */

/** Icon-only button (drag handles excluded — those are plain spans). */
export function IconBtn({
  label,
  onClick,
  tone,
  children,
}: {
  label: string;
  onClick?: () => void;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx("kb-iconbtn", tone && `kb-iconbtn--${tone}`)}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Text input with a trailing unit (e.g. "%"). */
export function AffixInput({
  suffix,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { suffix: string; invalid?: boolean }) {
  return (
    <span className="kb-affix">
      <input {...props} className={cx("kb-input", invalid && "is-error", props.className)} />
      <span className="kb-affix__s">{suffix}</span>
    </span>
  );
}

/**
 * Free-text chips (tags, brands, types): type and press Enter or comma to add,
 * × to remove. Optional suggestions via a native datalist.
 */
export function TokenInput({
  values,
  onChange,
  placeholder,
  suggestions,
  id,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  id: string;
}) {
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const p of parts) {
      if (seen.has(p.toLowerCase())) continue;
      seen.add(p.toLowerCase());
      next.push(p);
    }
    onChange(next);
  };
  return (
    <div className="kb-tokens">
      {values.map((v) => (
        <span key={v} className="kb-token">
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((x) => x !== v))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="kb-tokens__input"
        list={suggestions?.length ? `${id}-list` : undefined}
        placeholder={values.length ? "" : placeholder}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(el.value);
            el.value = "";
          } else if (e.key === "Backspace" && !el.value && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={(e) => {
          add(e.currentTarget.value);
          e.currentTarget.value = "";
        }}
        onChange={(e) => {
          // Picking a datalist suggestion fills the whole value at once.
          const v = e.currentTarget.value;
          if (suggestions?.includes(v)) {
            add(v);
            e.currentTarget.value = "";
          }
        }}
      />
      {suggestions?.length ? (
        <datalist id={`${id}-list`}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}
