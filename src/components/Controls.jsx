import { useId, useState } from 'react';

export function Section({ title, children, defaultOpen = true, aside }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header className="section-head">
        <button type="button" className="section-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <svg className="chevron" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{title}</span>
        </button>
        {aside}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Slider({ label, value, min, max, step, onChange, format, hint }) {
  const id = useId();
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="field" title={hint}>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="slider">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          style={{ '--fill': `${fill}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output htmlFor={id} className="field-value">{format ? format(value) : value}</output>
      </div>
    </div>
  );
}

export function Segmented({ label, value, options, onChange, columns }) {
  return (
    <div className="field field-stack">
      {label && <span className="field-label">{label}</span>}
      <div className="segmented" role="radiogroup" aria-label={label} style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : undefined}>
        {options.map((o) => (
          <button
            type="button"
            key={o.value}
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? 'active' : ''}
            onClick={() => onChange(o.value)}
            title={o.hint}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint }) {
  const id = useId();
  return (
    <div className="field" title={hint}>
      <label htmlFor={id} className="field-label">{label}</label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

export function ColorField({ label, value, onChange, swatches }) {
  const id = useId();
  const [draft, setDraft] = useState(null);
  const commit = (v) => {
    const hex = v.startsWith('#') ? v : `#${v}`;
    if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase());
    setDraft(null);
  };
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="color-field">
        {swatches && (
          <div className="swatches">
            {swatches.map((s) => (
              <button
                type="button"
                key={s}
                className={`swatch ${s.toLowerCase() === value.toLowerCase() ? 'active' : ''}`}
                style={{ background: s }}
                onClick={() => onChange(s)}
                aria-label={s}
              />
            ))}
          </div>
        )}
        <label className="color-input" style={{ background: value }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} />
        </label>
        <input
          id={id}
          className="hex-input"
          value={draft ?? value.replace('#', '').toUpperCase()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
          spellCheck={false}
          maxLength={7}
        />
      </div>
    </div>
  );
}

export function Select({ label, value, options, onChange }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
