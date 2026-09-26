import { describe, it, expect } from 'vitest';
import { configDiff, parseShareHash, buildShareUrl } from './share';
import { DEFAULT_CONFIG } from './config';

describe('share links', () => {
  it('encodes only the settings that differ from the defaults', () => {
    expect(configDiff(DEFAULT_CONFIG)).toEqual({});
    expect(configDiff({ ...DEFAULT_CONFIG, gap: 7, intro: 'vortex' })).toEqual({ gap: 7, intro: 'vortex' });
  });

  it('round-trips a preset link synchronously', async () => {
    const config = { ...DEFAULT_CONFIG, layout: 'grid', background: '#ffffff' };
    const { url, includesSvg } = await buildShareUrl({ source: { type: 'preset', id: 'hex' }, config, base: 'https://x.test/' });
    expect(includesSvg).toBe(false);
    const parsed = parseShareHash(url.slice(url.indexOf('#')));
    expect(parsed.preset).toBe('hex');
    expect(parsed.config).toEqual({ layout: 'grid', background: '#ffffff' });
    expect(parsed.svg).toBeUndefined();
  });

  it('round-trips a custom SVG through deflate', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#fff"/></svg>';
    const { url, includesSvg } = await buildShareUrl({ source: { type: 'custom', svg, name: 'mark.svg' }, config: DEFAULT_CONFIG, base: 'https://x.test/' });
    expect(includesSvg).toBe(true);
    const parsed = parseShareHash(url.slice(url.indexOf('#')));
    expect(parsed.preset).toBeUndefined();
    await expect(parsed.svg).resolves.toEqual({ svg, name: 'mark.svg' });
  });

  it('drops an SVG that would make the link too long', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg">' + Array.from({ length: 3000 }, (_, i) => `<path d="M${i} ${i * 7 % 97}l${i % 13} ${i % 17}"/>`).join('') + '</svg>';
    const { url, includesSvg } = await buildShareUrl({ source: { type: 'custom', svg, name: 'big' }, config: DEFAULT_CONFIG, base: 'https://x.test/' });
    expect(includesSvg).toBe(false);
    expect(url.length).toBeLessThan(200);
  });

  it('ignores malformed or foreign hashes', () => {
    expect(parseShareHash('')).toBeNull();
    expect(parseShareHash('#foo')).toBeNull();
    expect(parseShareHash('#s=!!!')).toBeNull();
    expect(parseShareHash('#s=' + btoa('{"v":99}'))).toBeNull();
  });
});
