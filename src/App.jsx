import { useState, useCallback, useRef } from 'react';
import './App.css';
import ParticleLogo from './ParticleLogo';
import { DITHER_ALGORITHMS } from './dithering';
import { PRESET_LOGOS } from './presets';

const DEFAULT_CONFIG = {
  gap: 6,
  particleSize: 4.5,
  sizeVariance: 0.3,
  softness: 0.1,
  spring: 0.055,
  damping: 0.85,
  repelRadius: 60,
  repelStrength: 5.0,
  ditherAlgorithm: 'hex-jitter',
  ditherIntensity: 0.2,
  bgColor: '#0a0a0a',
};

function Slider({ label, value, min, max, step, onChange, format }) {
  return (
    <div className="control-row">
      <span className="control-label">{label}</span>
      <div className="control-slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="control-value">{format ? format(value) : value}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [activePreset, setActivePreset] = useState('linear');
  const [customSvg, setCustomSvg] = useState('');
  const [svgSource, setSvgSource] = useState('preset'); // 'preset' or 'custom'
  const [particleCount, setParticleCount] = useState(0);
  const [key, setKey] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const currentSvg = svgSource === 'custom' && customSvg
    ? customSvg
    : PRESET_LOGOS[activePreset].svg;

  const set = useCallback((field, val) => {
    setConfig((c) => ({ ...c, [field]: val }));
  }, []);

  const replay = () => setKey((k) => k + 1);

  // Structural changes that need re-init
  const setStructural = useCallback((field, val) => {
    setConfig((c) => ({ ...c, [field]: val }));
    setKey((k) => k + 1);
  }, []);

  const handlePreset = (id) => {
    setActivePreset(id);
    setSvgSource('preset');
    setKey((k) => k + 1);
  };

  const handleFileUpload = (file) => {
    if (!file || !file.name.endsWith('.svg')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setCustomSvg(e.target.result);
      setSvgSource('custom');
      setKey((k) => k + 1);
    };
    reader.readAsText(file);
  };

  const handlePaste = (text) => {
    setCustomSvg(text);
    if (text.trim().startsWith('<svg') || text.trim().startsWith('<?xml')) {
      setSvgSource('custom');
      setKey((k) => k + 1);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  };

  return (
    <div className="app">
      {/* Canvas Area */}
      <div className="canvas-area">
        <div className="canvas-header">
          <h1>particle logo</h1>
          <p>hover to interact</p>
        </div>

        <ParticleLogo
          key={key}
          svgString={currentSvg}
          width={400}
          height={400}
          config={config}
          onParticleCount={setParticleCount}
        />

        <div className="particle-count">
          {particleCount.toLocaleString()} particles
        </div>
      </div>

      {/* Sidebar Controls */}
      <div className="sidebar">
        <div className="sidebar-title">Controls</div>

        {/* Preset Logos */}
        <div className="controls-section">
          <div className="section-label">Logo Presets</div>
          <div className="preset-grid">
            {Object.entries(PRESET_LOGOS).map(([id, logo]) => (
              <button
                key={id}
                className={`preset-btn ${activePreset === id && svgSource === 'preset' ? 'active' : ''}`}
                onClick={() => handlePreset(id)}
              >
                <svg viewBox="0 0 24 24" fill={logo.color}>
                  <circle cx="12" cy="12" r="8" />
                </svg>
                <span>{logo.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom SVG Upload */}
        <div className="controls-section">
          <div className="section-label">Custom SVG</div>
          <div className="svg-upload">
            <div
              className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="upload-icon">+</div>
              <div className="upload-text">Drop SVG or click to upload</div>
              <div className="upload-hint">Works best with simple, filled shapes</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".svg"
                className="upload-input"
                onChange={(e) => handleFileUpload(e.target.files[0])}
                style={{ display: 'none' }}
              />
            </div>
            <textarea
              className="svg-paste"
              placeholder="or paste SVG markup here..."
              value={svgSource === 'custom' ? customSvg.slice(0, 200) + (customSvg.length > 200 ? '...' : '') : ''}
              onChange={(e) => handlePaste(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        {/* Particle Settings */}
        <div className="controls-section">
          <div className="section-label">Particles</div>
          <Slider
            label="density"
            value={config.gap}
            min={3} max={14} step={0.5}
            onChange={(v) => setStructural('gap', v)}
            format={(v) => `${v}px`}
          />
          <Slider
            label="size"
            value={config.particleSize}
            min={1} max={12} step={0.5}
            onChange={(v) => set('particleSize', v)}
          />
          <Slider
            label="size var"
            value={config.sizeVariance}
            min={0} max={1} step={0.05}
            onChange={(v) => set('sizeVariance', v)}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            label="softness"
            value={config.softness}
            min={0} max={1} step={0.05}
            onChange={(v) => set('softness', v)}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>

        {/* Dithering */}
        <div className="controls-section">
          <div className="section-label">Dithering</div>
          <div className="control-row">
            <span className="control-label">algorithm</span>
            <select
              className="control-select"
              value={config.ditherAlgorithm}
              onChange={(e) => setStructural('ditherAlgorithm', e.target.value)}
            >
              {Object.entries(DITHER_ALGORITHMS).map(([id, algo]) => (
                <option key={id} value={id}>{algo.name}</option>
              ))}
            </select>
          </div>
          {DITHER_ALGORITHMS[config.ditherAlgorithm]?.hasIntensity && (
            <Slider
              label="intensity"
              value={config.ditherIntensity}
              min={0} max={0.5} step={0.01}
              onChange={(v) => setStructural('ditherIntensity', v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
        </div>

        {/* Physics */}
        <div className="controls-section">
          <div className="section-label">Physics</div>
          <Slider
            label="spring"
            value={config.spring}
            min={0.01} max={0.15} step={0.005}
            onChange={(v) => set('spring', v)}
          />
          <Slider
            label="damping"
            value={config.damping}
            min={0.7} max={0.98} step={0.01}
            onChange={(v) => set('damping', v)}
          />
          <Slider
            label="repel ∅"
            value={config.repelRadius}
            min={20} max={150} step={5}
            onChange={(v) => set('repelRadius', v)}
            format={(v) => `${v}px`}
          />
          <Slider
            label="repel str"
            value={config.repelStrength}
            min={0.5} max={15} step={0.5}
            onChange={(v) => set('repelStrength', v)}
          />
        </div>

        {/* Actions */}
        <div className="controls-section">
          <div className="btn-row">
            <button className="btn btn-accent" onClick={replay}>
              replay
            </button>
            <button className="btn" onClick={() => setConfig(DEFAULT_CONFIG)}>
              reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
