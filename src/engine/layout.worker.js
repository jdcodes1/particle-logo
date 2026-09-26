/**
 * Layout worker: keeps rasterized fields (and their traced outlines) cached
 * off the main thread and builds particle layouts on request.
 */
import { buildLayout } from './layouts';

const fields = new Map();
const MAX_FIELDS = 3;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'field') {
    fields.set(msg.key, msg.field);
    while (fields.size > MAX_FIELDS) fields.delete(fields.keys().next().value);
    return;
  }
  if (msg.type === 'layout') {
    const field = fields.get(msg.key);
    if (!field) {
      self.postMessage({ id: msg.id, missing: true });
      return;
    }
    try {
      const layout = buildLayout(field, msg.cfg);
      self.postMessage({ id: msg.id, layout }, [layout.home.buffer, layout.color.buffer, layout.scale.buffer, layout.edge.buffer]);
    } catch (err) {
      self.postMessage({ id: msg.id, error: err.message || String(err) });
    }
  }
};
