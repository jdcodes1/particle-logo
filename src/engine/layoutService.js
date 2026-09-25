/**
 * Runs layouts in a Web Worker when available (so the animation never
 * stutters while sliders move), falling back to the main thread otherwise.
 * Fields are transferred to the worker once and cached there by key.
 */
import { buildLayout } from './layouts';

const MAX_FIELDS = 3;

export class MissingFieldError extends Error {}

export function createLayoutService() {
  let worker = null;
  try {
    worker = new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  const pending = new Map();
  const keys = []; // insertion order, mirrors the worker's cache
  const local = new Map();
  let nextId = 1;

  const failAll = (err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  if (worker) {
    worker.onmessage = (e) => {
      const { id, layout, error, missing } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (missing) p.reject(new MissingFieldError('Field not cached'));
      else if (error) p.reject(new Error(error));
      else p.resolve(layout);
    };
    worker.onerror = () => {
      // Worker unusable (e.g. blocked by CSP): continue on the main thread.
      worker.terminate();
      worker = null;
      keys.length = 0;
      failAll(new MissingFieldError('Layout worker failed'));
    };
  }

  return {
    has(key) {
      return worker ? keys.includes(key) : local.has(key);
    },
    addField(key, field) {
      if (worker) {
        keys.push(key);
        while (keys.length > MAX_FIELDS) keys.shift();
        worker.postMessage({ type: 'field', key, field }, [field.alpha.buffer, field.rgba.buffer]);
      } else {
        local.set(key, field);
        while (local.size > MAX_FIELDS) local.delete(local.keys().next().value);
      }
    },
    layout(key, cfg) {
      if (!worker) {
        const field = local.get(key);
        if (!field) return Promise.reject(new MissingFieldError('Field not cached'));
        return Promise.resolve(buildLayout(field, cfg));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'layout', id, key, cfg });
      });
    },
    dispose() {
      worker?.terminate();
      failAll(new Error('disposed'));
    },
  };
}
