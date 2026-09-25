import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import ParticleLogo from './ParticleLogo';
import { PRESET_LOGOS } from './presets';
import { ASPECTS, DEFAULT_CONFIG } from './engine/config';
import { INTRO_STYLES } from './engine/ParticleEngine';
import { LAYOUTS } from './engine/layouts';
import { contrastRatio, hexToRgb } from './engine/color';
import { download } from './engine/exporters';
import { parseSvg } from './engine/rasterize';
import { Section, Slider, Segmented, Toggle, ColorField, Select } from './components/Controls';
import {
  ReplayIcon, ExpandIcon, UploadIcon, DownloadIcon, ShuffleIcon, ResetIcon, CloseIcon, CodeIcon,
} from './components/Icons';

const STORAGE_KEY = 'particle-logo:v2';
const BACKGROUNDS = ['#0a0a0b', '#000000', '#10131c', '#f5f5f7', '#ffffff'];
const DOT_COLORS = ['#f5f5f7', '#000000', '#5e6ad2', '#22d3ee', '#ff375f'];

const pct = (v) => `${Math.round(v * 100)}%`;
const units = (v) => `${v}`;
const secs = (v) => `${v}s`;

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return {
      config: { ...DEFAULT_CONFIG, ...(saved.config || {}) },
      source: saved.source?.type === 'custom' && saved.source.svg ? saved.source : { type: 'preset', id: saved.source?.id in PRESET_LOGOS ? saved.source.id : 'linear' },
    };
  } catch {
    return null;
  }
}

function isSvgText(text) {
  const t = String(text || '').trim();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(t);
}

function slug(name) {
  return String(name || 'logo').toLowerCase().replace(/\.svg$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'logo';
}

function thumbUrl(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

export default function App() {
  const saved = useMemo(loadSaved, []);
  const [config, setConfig] = useState(saved?.config ?? DEFAULT_CONFIG);
  const [source, setSource] = useState(saved?.source ?? { type: 'preset', id: 'linear' });
  const [stats, setStats] = useState({ count: 0 });
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [presenting, setPresenting] = useState(false);
  const [pointerIdle, setPointerIdle] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [exporting, setExporting] = useState(null); // { kind, progress }
  const [exportOpts, setExportOpts] = useState({ png: 4096, transparent: false, video: 1920, hold: 3, loop: false, videoAlpha: false });
  const logoRef = useRef(null);
  const fileRef = useRef(null);
  const abortRef = useRef(null);
  const contrastCheck = useRef(false);

  useEffect(() => {
    // Handy for debugging and automated visual checks during development.
    if (import.meta.env.DEV) window.__particleLogo = logoRef;
  }, []);

  const svg = source.type === 'custom' ? source.svg : PRESET_LOGOS[source.id].svg;
  const sourceName = source.type === 'custom' ? source.name || 'custom' : PRESET_LOGOS[source.id].name;

  const set = useCallback((key, value) => setConfig((c) => ({ ...c, [key]: value })), []);
  const setExport = (key, value) => setExportOpts((o) => ({ ...o, [key]: value }));

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone, id: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  // Persist settings (best effort — storage may be unavailable).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ config, source }));
    } catch {
      /* ignore */
    }
  }, [config, source]);

  const loadCustom = useCallback((text, name = 'custom') => {
    try {
      if (!isSvgText(text)) throw new Error('That doesn’t look like SVG markup.');
      parseSvg(text);
    } catch (err) {
      notify(err.message, 'error');
      return;
    }
    contrastCheck.current = true;
    setSource({ type: 'custom', svg: text, name });
  }, [notify]);

  const handleFile = useCallback((file) => {
    if (!file) return;
    if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
      notify('Please choose an .svg file.', 'error');
      return;
    }
    file.text().then((text) => loadCustom(text, file.name));
  }, [loadCustom, notify]);

  const onStats = useCallback((s) => {
    setStats(s);
    if (!contrastCheck.current || !s.avgColor) return;
    contrastCheck.current = false;
    setConfig((c) => {
      if (c.colorMode !== 'original') return c;
      const bg = hexToRgb(c.background);
      if (contrastRatio(s.avgColor, bg) >= 1.6) return c;
      const light = contrastRatio([1, 1, 1], bg) > contrastRatio([0, 0, 0], bg);
      setTimeout(() => notify('Logo colors blend into the background — switched to a solid color.'), 0);
      return { ...c, colorMode: 'solid', color: light ? '#f5f5f7' : '#111111' };
    });
  }, [notify]);

  // Present mode: go fullscreen when possible and hide the cursor when idle.
  useEffect(() => {
    if (!presenting) return;
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
    let timer = setTimeout(() => setPointerIdle(true), 2500);
    const onMove = () => {
      setPointerIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setPointerIdle(true), 2500);
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    window.addEventListener('pointermove', onMove);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      clearTimeout(timer);
      setPointerIdle(false);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [presenting]);

  // Global shortcuts, paste and drag & drop.
  useEffect(() => {
    const inField = (e, selector) => e.target instanceof Element && e.target.closest(selector);
    const onKey = (e) => {
      if (inField(e, 'input, textarea, select, [contenteditable]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'r' || e.key === 'R') logoRef.current?.replay();
      else if (e.key === 'f' || e.key === 'F') setPresenting((p) => !p);
      else if (e.key === 'Escape') setPresenting(false);
    };
    const onPaste = (e) => {
      if (inField(e, 'input, textarea')) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text && isSvgText(text)) {
        e.preventDefault();
        loadCustom(text, 'pasted');
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, [loadCustom]);

  const runExport = async (kind) => {
    const api = logoRef.current;
    if (!api || exporting) return;
    const base = `particle-${slug(sourceName)}`;
    try {
      if (kind === 'png') {
        setExporting({ kind, progress: null });
        const blob = await api.exportPNG({ longEdge: exportOpts.png, transparent: exportOpts.transparent });
        download(blob, `${base}-${exportOpts.png}.png`);
      } else if (kind === 'svg') {
        const text = api.exportSVG({ transparent: exportOpts.transparent });
        download(new Blob([text], { type: 'image/svg+xml' }), `${base}.svg`);
      } else if (kind === 'html') {
        const html = api.exportHTML({ transparent: exportOpts.transparent, title: `${sourceName} — particle logo` });
        download(new Blob([html], { type: 'text/html' }), `${base}.html`);
      } else if (kind === 'video') {
        const controller = new AbortController();
        abortRef.current = controller;
        setExporting({ kind, progress: 0 });
        const { blob, codec, extension } = await api.exportVideo({
          longEdge: exportOpts.video,
          hold: exportOpts.hold,
          loop: exportOpts.loop,
          transparent: exportOpts.videoAlpha,
          signal: controller.signal,
          onProgress: (p) => setExporting({ kind, progress: p }),
        });
        download(blob, `${base}-${exportOpts.video}.${extension}`);
        const label = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1' }[codec] || codec;
        notify(
          extension === 'mp4' && codec !== 'avc'
            ? `Exported ${label} MP4 — H.264 isn’t available in this browser.`
            : `Exported ${label} ${extension.toUpperCase()}.`,
        );
        return;
      }
      notify('Export ready.');
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error(err);
        notify(err.message || 'Export failed.', 'error');
      }
    } finally {
      abortRef.current = null;
      setExporting(null);
    }
  };

  const layoutHasShape = config.layout === 'grid' || config.layout === 'halftone';
  const usesTone = config.layout === 'halftone' || config.layout === 'dither';
  const stage = ASPECTS[config.aspect];

  return (
    <div
      className={`app ${presenting ? 'presenting' : ''} ${presenting && pointerIdle ? 'idle' : ''}`}
      onDragOver={(e) => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFile(e.dataTransfer.files?.[0]);
      }}
    >
      <main className="workspace">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => <i key={i} />)}
            </span>
            <span className="brand-name">Particle Logo</span>
          </div>
          <div className="topbar-center">
            <div className="segmented compact" role="radiogroup" aria-label="Aspect ratio">
              {Object.entries(ASPECTS).map(([key, a]) => (
                <button
                  type="button"
                  key={key}
                  role="radio"
                  aria-checked={config.aspect === key}
                  className={config.aspect === key ? 'active' : ''}
                  onClick={() => set('aspect', key)}
                  title={`${a.name} · ${key}`}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
          <div className="topbar-actions">
            <button type="button" className="icon-btn" onClick={() => logoRef.current?.replay()} title="Replay intro (R)">
              <ReplayIcon />
              <span>Replay</span>
            </button>
            <button type="button" className="icon-btn" onClick={() => setPresenting(true)} title="Present (F)">
              <ExpandIcon />
              <span>Present</span>
            </button>
          </div>
        </header>

        <div className="stage" style={{ '--stage-bg': config.background, '--stage-aspect': `${stage.w} / ${stage.h}` }}>
          <ParticleLogo
            ref={logoRef}
            svg={svg}
            config={config}
            onStats={onStats}
            onError={setError}
            className="stage-canvas"
          />
          {presenting && (
            <button type="button" className="exit-present" onClick={() => setPresenting(false)} title="Exit (Esc)">
              <CloseIcon />
            </button>
          )}
        </div>

        <footer className="statusbar">
          <span>{sourceName}</span>
          <span className="dot-sep" />
          <span>{stats.count.toLocaleString()} particles</span>
          <span className="dot-sep" />
          <span>{stage.w} × {stage.h}</span>
          {error && (
            <>
              <span className="dot-sep" />
              <span className="status-error">{error}</span>
            </>
          )}
          <span className="statusbar-hint">Hover to interact · click to burst · drop or paste an SVG</span>
        </footer>
      </main>

      <aside className="panel" aria-label="Settings">
        <Section title="Logo">
          <div className="preset-grid">
            {Object.entries(PRESET_LOGOS).map(([id, p]) => (
              <button
                type="button"
                key={id}
                className={`preset ${source.type === 'preset' && source.id === id ? 'active' : ''}`}
                onClick={() => setSource({ type: 'preset', id })}
                title={p.name}
              >
                <img src={thumbUrl(p.svg)} alt="" draggable={false} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
          <div className="button-row">
            <button type="button" className={`btn ${source.type === 'custom' ? 'btn-active' : ''}`} onClick={() => fileRef.current?.click()}>
              <UploadIcon />
              Upload SVG
            </button>
            <button type="button" className={`btn ${pasteOpen ? 'btn-active' : ''}`} onClick={() => setPasteOpen((o) => !o)}>
              <CodeIcon />
              Paste code
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".svg,image/svg+xml"
              hidden
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {pasteOpen && (
            <div className="paste">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="<svg viewBox=…>…</svg>"
                rows={5}
                spellCheck={false}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!pasteText.trim()}
                onClick={() => {
                  loadCustom(pasteText, 'pasted');
                  setPasteOpen(false);
                }}
              >
                Use this SVG
              </button>
            </div>
          )}
          <Slider label="Logo size" value={config.logoScale} min={0.3} max={0.9} step={0.01} onChange={(v) => set('logoScale', v)} format={pct} />
        </Section>

        <Section title="Layout">
          <Segmented
            value={config.layout}
            onChange={(v) => set('layout', v)}
            options={Object.entries(LAYOUTS).map(([value, l]) => ({ value, label: l.name, hint: l.description }))}
          />
          <Slider
            label="Spacing"
            value={config.gap}
            min={3}
            max={14}
            step={0.25}
            onChange={(v) => set('gap', v)}
            format={units}
            hint="Distance between particles, in stage units"
          />
          {layoutHasShape && (
            <Segmented
              label="Lattice"
              value={config.gridShape}
              onChange={(v) => set('gridShape', v)}
              options={[{ value: 'hex', label: 'Hexagonal' }, { value: 'square', label: 'Square' }]}
            />
          )}
          {config.layout === 'organic' && (
            <>
              <Slider label="Edge inset" value={config.edgeInset} min={0} max={0.6} step={0.01} onChange={(v) => set('edgeInset', v)} format={pct} hint="How far outline particles sit inside the shape edge" />
              <div className="field">
                <span className="field-label">Arrangement</span>
                <button type="button" className="btn btn-small" onClick={() => set('seed', Math.floor(Math.random() * 1e6))}>
                  <ShuffleIcon />
                  Shuffle
                </button>
              </div>
            </>
          )}
          {usesTone && (
            <Slider label="Tone gamma" value={config.toneGamma} min={0.4} max={2.5} step={0.05} onChange={(v) => set('toneGamma', v)} format={(v) => v.toFixed(2)} />
          )}
          {config.layout === 'dither' && (
            <>
              <Slider label="Threshold" value={config.ditherThreshold} min={0.05} max={0.95} step={0.01} onChange={(v) => set('ditherThreshold', v)} format={pct} />
              <Toggle label="Invert tone" checked={config.ditherInvert} onChange={(v) => set('ditherInvert', v)} />
            </>
          )}
        </Section>

        <Section title="Particles">
          <Slider label="Dot size" value={config.dotSize} min={0.5} max={14} step={0.1} onChange={(v) => set('dotSize', v)} format={(v) => v.toFixed(1)} />
          <Slider label="Size variance" value={config.sizeVariance} min={0} max={0.6} step={0.01} onChange={(v) => set('sizeVariance', v)} format={pct} />
          <Slider label="Brightness var." value={config.brightnessVariance} min={0} max={0.5} step={0.01} onChange={(v) => set('brightnessVariance', v)} format={pct} />
          <Slider label="Softness" value={config.softness} min={0} max={1} step={0.01} onChange={(v) => set('softness', v)} format={pct} />
          <Slider label="Glow" value={config.glow} min={0} max={0.6} step={0.01} onChange={(v) => set('glow', v)} format={pct} />
          {config.glow > 0 && (
            <Slider label="Glow radius" value={config.glowSize} min={2} max={10} step={0.1} onChange={(v) => set('glowSize', v)} format={(v) => `${v.toFixed(1)}×`} />
          )}
        </Section>

        <Section title="Color">
          <Segmented
            value={config.colorMode}
            onChange={(v) => set('colorMode', v)}
            options={[
              { value: 'original', label: 'Original' },
              { value: 'solid', label: 'Solid' },
              { value: 'gradient', label: 'Gradient' },
            ]}
          />
          {config.colorMode === 'solid' && (
            <ColorField label="Particles" value={config.color} onChange={(v) => set('color', v)} swatches={DOT_COLORS} />
          )}
          {config.colorMode === 'gradient' && (
            <>
              <ColorField label="From" value={config.gradientFrom} onChange={(v) => set('gradientFrom', v)} />
              <ColorField label="To" value={config.gradientTo} onChange={(v) => set('gradientTo', v)} />
              <Slider label="Angle" value={config.gradientAngle} min={0} max={360} step={1} onChange={(v) => set('gradientAngle', v)} format={(v) => `${v}°`} />
            </>
          )}
          <ColorField label="Background" value={config.background} onChange={(v) => set('background', v)} swatches={BACKGROUNDS} />
          <Toggle label="Spotlight" checked={config.spotlight} onChange={(v) => set('spotlight', v)} hint="Soft radial light behind the logo" />
        </Section>

        <Section title="Motion">
          <Segmented
            label="Intro"
            value={config.intro}
            onChange={(v) => set('intro', v)}
            columns={3}
            options={Object.entries(INTRO_STYLES).map(([value, s]) => ({ value, label: s.name }))}
          />
          <Slider label="Intro speed" value={config.introSpeed} min={0.4} max={2.5} step={0.05} onChange={(v) => set('introSpeed', v)} format={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Idle drift" value={config.idle} min={0} max={2} step={0.05} onChange={(v) => set('idle', v)} format={(v) => v.toFixed(2)} />
          <Slider label="Twinkle" value={config.twinkle} min={0} max={0.5} step={0.01} onChange={(v) => set('twinkle', v)} format={pct} />
          <Slider label="Sheen" value={config.sheen} min={0} max={1} step={0.01} onChange={(v) => set('sheen', v)} format={pct} hint="A periodic highlight sweeping across the logo" />
          {config.sheen > 0 && (
            <Slider label="Sheen every" value={config.sheenInterval} min={1} max={12} step={0.5} onChange={(v) => set('sheenInterval', v)} format={secs} />
          )}
        </Section>

        <Section title="Interaction" defaultOpen={false}>
          <Slider label="Radius" value={config.repelRadius} min={30} max={260} step={5} onChange={(v) => set('repelRadius', v)} format={units} />
          <Slider label="Force" value={config.repelStrength} min={0} max={12} step={0.1} onChange={(v) => set('repelStrength', v)} format={(v) => v.toFixed(1)} />
          <Slider label="Swirl" value={config.swirl} min={-1} max={1} step={0.05} onChange={(v) => set('swirl', v)} format={(v) => v.toFixed(2)} />
          <Slider label="Drag" value={config.drag} min={0} max={1.5} step={0.05} onChange={(v) => set('drag', v)} format={(v) => v.toFixed(2)} hint="How much particles follow the cursor's motion" />
          <Slider label="Lens" value={config.lens} min={0} max={1.5} step={0.05} onChange={(v) => set('lens', v)} format={pct} hint="Magnify particles under the cursor" />
          <Slider label="Spring" value={config.spring} min={0.01} max={0.2} step={0.005} onChange={(v) => set('spring', v)} format={(v) => v.toFixed(3)} />
          <Slider label="Damping" value={config.damping} min={0.6} max={0.97} step={0.01} onChange={(v) => set('damping', v)} format={(v) => v.toFixed(2)} />
          <Toggle label="Click burst" checked={config.clickBurst} onChange={(v) => set('clickBurst', v)} />
        </Section>

        <Section title="Export">
          <Select
            label="Image size"
            value={exportOpts.png}
            onChange={(v) => setExport('png', Number(v))}
            options={[
              { value: 2048, label: '2K · 2048 px' },
              { value: 4096, label: '4K · 4096 px' },
              { value: 8192, label: '8K · 8192 px' },
            ]}
          />
          <Toggle label="Transparent" checked={exportOpts.transparent} onChange={(v) => setExport('transparent', v)} hint="Omit the background from PNG, SVG and embed exports" />
          <div className="button-row">
            <button type="button" className="btn" disabled={!!exporting} onClick={() => runExport('png')}>
              <DownloadIcon />
              PNG
            </button>
            <button type="button" className="btn" disabled={!!exporting} onClick={() => runExport('svg')}>
              <DownloadIcon />
              SVG
            </button>
            <button type="button" className="btn" disabled={!!exporting} onClick={() => runExport('html')} title="Self-contained interactive HTML — host it or embed with an iframe">
              <CodeIcon />
              Embed
            </button>
          </div>
          <div className="divider" />
          <Select
            label="Video"
            value={exportOpts.video}
            onChange={(v) => setExport('video', Number(v))}
            options={[
              { value: 1280, label: '720p' },
              { value: 1920, label: '1080p' },
              { value: 3840, label: '4K' },
            ]}
          />
          <Slider label="Hold after intro" value={exportOpts.hold} min={0} max={10} step={0.5} onChange={(v) => setExport('hold', v)} format={secs} />
          <Toggle label="Loop" checked={exportOpts.loop} onChange={(v) => setExport('loop', v)} hint="Play the intro in reverse at the end so the clip loops seamlessly" />
          <Toggle label="Alpha (WebM)" checked={exportOpts.videoAlpha} onChange={(v) => setExport('videoAlpha', v)} hint="Transparent VP9 WebM instead of MP4" />
          {exporting?.kind === 'video' ? (
            <div className="progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round((exporting.progress || 0) * 100)}%` }} />
              </div>
              <button type="button" className="btn btn-small" onClick={() => abortRef.current?.abort()}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary btn-block" disabled={!!exporting} onClick={() => runExport('video')}>
              <DownloadIcon />
              Render {exportOpts.videoAlpha ? 'WebM' : 'MP4'} · 60 fps
            </button>
          )}
        </Section>

        <div className="panel-footer">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setConfig(DEFAULT_CONFIG);
              notify('Settings reset.');
            }}
          >
            <ResetIcon />
            Reset settings
          </button>
        </div>
      </aside>

      {dragOver && (
        <div className="drop-overlay">
          <div>Drop an SVG to turn it into particles</div>
        </div>
      )}
      {toast && (
        <div key={toast.id} className={`toast ${toast.tone}`} role="status">
          {toast.message}
        </div>
      )}
    </div>
  );
}
