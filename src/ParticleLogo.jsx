import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ParticleEngine } from './engine/ParticleEngine';
import { rasterizeSvg } from './engine/rasterize';
import { buildLayout } from './engine/layouts';
import { ASPECTS, LAYOUT_KEYS, RASTER_KEYS } from './engine/config';
import { exportPNG, exportSVG, exportVideo, exportHTML } from './engine/exporters';

const keyOf = (cfg, keys) => keys.map((k) => String(cfg[k])).join('|');

/**
 * Renders an SVG logo as an interactive particle field.
 *
 * Props:
 *  - svg: SVG markup
 *  - config: see engine/config.js DEFAULT_CONFIG
 *  - onStats({ count }), onError(message | null)
 *  - ref: { replay(), exportPNG(opts), exportSVG(opts), exportVideo(opts), exportHTML(opts) }
 */
export default function ParticleLogo({ svg, config, onStats, onError, className = '', ref }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const fieldRef = useRef({ key: null, field: null });
  const layoutKeyRef = useRef(null);
  const callbacks = useRef({ onStats, onError });
  const [status, setStatus] = useState('loading');
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    callbacks.current = { onStats, onError };
  });

  const stage = ASPECTS[config.aspect] || ASPECTS['1:1'];

  // Engine lifetime.
  useEffect(() => {
    const engine = new ParticleEngine(canvasRef.current, {
      onStats: (s) => callbacks.current.onStats?.(s),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Fit the canvas to the frame at the stage's aspect ratio.
  useEffect(() => {
    const el = frameRef.current;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const s = Math.min(width / stage.w, height / stage.h);
      setBox({ w: Math.floor(stage.w * s), h: Math.floor(stage.h * s) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage.w, stage.h]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !box.w) return;
    engine.setStage(stage.w, stage.h);
    engine.setViewport(box.w, box.h, Math.min(window.devicePixelRatio || 1, 2.5));
  }, [box.w, box.h, stage.w, stage.h]);

  // Live (non-structural) settings.
  useEffect(() => {
    engineRef.current?.setConfig(config);
  }, [config]);

  // Picking a different intro previews it right away.
  const introRef = useRef(config.intro);
  useEffect(() => {
    if (introRef.current === config.intro) return;
    introRef.current = config.intro;
    engineRef.current?.replay();
  }, [config.intro]);

  // Structural: rasterize + layout, debounced so sliders stay responsive.
  const rasterKey = svg + '§' + keyOf(config, RASTER_KEYS);
  const layoutKey = rasterKey + '§' + keyOf(config, LAYOUT_KEYS);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const engine = engineRef.current;
      if (!engine) return;
      const cfg = configRef.current;
      const st = ASPECTS[cfg.aspect] || ASPECTS['1:1'];
      try {
        let field = fieldRef.current.key === rasterKey ? fieldRef.current.field : null;
        if (!field) {
          field = await rasterizeSvg(svg, { stageW: st.w, stageH: st.h, logoScale: cfg.logoScale, supersample: 2 });
          if (cancelled) return;
          fieldRef.current = { key: rasterKey, field };
        }
        const layout = buildLayout(field, cfg);
        if (cancelled) return;
        if (!layout.count) throw new Error('No visible particles — try a denser setting');
        engine.setStage(st.w, st.h);
        const first = layoutKeyRef.current === null;
        engine.setLayout(layout, first ? 'intro' : 'morph');
        layoutKeyRef.current = layoutKey;
        setStatus('ready');
        callbacks.current.onError?.(null);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        if (layoutKeyRef.current === null) setStatus('error');
        callbacks.current.onError?.(err.message || String(err));
      }
    }, layoutKeyRef.current === null ? 0 : 80);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [svg, rasterKey, layoutKey]);

  useImperativeHandle(ref, () => ({
    replay: () => engineRef.current?.replay(),
    exportPNG: (opts) => exportPNG(engineRef.current, opts),
    exportSVG: (opts) => exportSVG(engineRef.current, opts),
    exportVideo: (opts) => exportVideo(engineRef.current, opts),
    exportHTML: (opts) => exportHTML(engineRef.current, opts),
    get engine() {
      return engineRef.current;
    },
  }), []);

  const toStage = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width - 0.5) * stage.w,
      (0.5 - (e.clientY - r.top) / r.height) * stage.h,
    ];
  };

  return (
    <div ref={frameRef} className={`particle-frame ${className}`}>
      <canvas
        ref={canvasRef}
        className="particle-canvas"
        style={{ width: box.w, height: box.h }}
        onPointerMove={(e) => engineRef.current?.pointerMove(...toStage(e))}
        onPointerLeave={() => engineRef.current?.pointerLeave()}
        onPointerCancel={() => engineRef.current?.pointerLeave()}
        onPointerDown={(e) => {
          const [x, y] = toStage(e);
          engineRef.current?.pointerMove(x, y);
          if (config.clickBurst) engineRef.current?.burst(x, y);
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== 'mouse') engineRef.current?.pointerLeave();
        }}
      />
      {status !== 'ready' && (
        <div className="particle-status">{status === 'error' ? 'This SVG could not be rendered' : 'Sampling…'}</div>
      )}
    </div>
  );
}
