// Left-thumb brush controls for the iPad. Drawing right-handed with a Pencil
// leaves the left thumb free near the bottom-left corner of the screen, so under
// a coarse pointer a compact strip of sliders (size, opacity, hardness, flow)
// and the pressure toggles sits there, mirroring the options bar. It follows
// the active tool and only shows for brush-like tools (those with `tool.brush`).
import type { Editor } from '../editor';
import { svg } from './icons';
import { brushFor, pressureOn } from '../features/paint';

const sliders: [key: 'size' | 'opacity' | 'hardness' | 'flow', label: string, min: number, max: number][] = [
  ['size', 'Size', 1, 500],
  ['opacity', 'Opacity', 1, 100],
  ['hardness', 'Hardness', 0, 100],
  ['flow', 'Flow', 1, 100],
];

export class BrushStrip {
  readonly el: HTMLElement;
  private toolId = '';
  private open = true;
  constructor(private e: Editor, host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'brush-strip canvas-ui';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Brush controls');
    this.el.hidden = true;
    host.appendChild(this.el);
    this.el.addEventListener('input', (ev) => {
      const t = ev.target as HTMLInputElement;
      const k = t.dataset.k;
      if (!k) return;
      const s = brushFor(this.toolId);
      const v = Number(t.value);
      if (k === 'size') s.size = v;
      else if (k === 'opacity') s.opacity = v / 100;
      else if (k === 'hardness') s.hardness = v / 100;
      else if (k === 'flow') s.flow = v / 100;
      t.nextElementSibling!.textContent = k === 'size' ? `${Math.round(v)} px` : `${Math.round(v)}%`;
    });
    // The options bar shows the same numbers; refresh it once the drag ends.
    this.el.addEventListener('change', () => this.e.options());
    this.el.addEventListener('click', (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-strip]');
      if (!b) return;
      const s = brushFor(this.toolId);
      if (b.dataset.strip === 'collapse') {
        this.open = !this.open;
        this.el.classList.toggle('collapsed', !this.open);
        b.setAttribute('aria-expanded', String(this.open));
        return;
      }
      if (b.dataset.strip === 'pressure-size') s.dynamics.pressureSize = !pressureOn(s.dynamics, 'pressureSize');
      if (b.dataset.strip === 'pressure-opacity') s.dynamics.pressureOpacity = !pressureOn(s.dynamics, 'pressureOpacity');
      this.e.options();
    });
  }
  /** Re-render for the active tool (called from Editor.options()). */
  update() {
    const tool = this.e.activeTool;
    if (!tool?.brush || this.e.transform.active) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    this.toolId = tool.id;
    const s = brushFor(tool.id);
    const value = (k: string) => (k === 'size' ? s.size : k === 'opacity' ? s.opacity * 100 : k === 'hardness' ? s.hardness * 100 : s.flow * 100);
    const rows = sliders
      .filter(([k]) => !(tool.id === 'pencil' && (k === 'hardness' || k === 'flow')))
      .map(([k, label, min, max]) => `<label class="brush-strip-row"><span>${label}</span><input type="range" min="${min}" max="${max}" step="1" value="${Math.round(value(k))}" data-k="${k}" aria-label="Brush ${label.toLowerCase()}"><output>${Math.round(value(k))}${k === 'size' ? ' px' : '%'}</output></label>`)
      .join('');
    this.el.innerHTML = `<div class="brush-strip-head"><button type="button" class="icon-button" data-strip="collapse" aria-expanded="${this.open}" aria-label="Collapse brush controls" title="Collapse brush controls">${svg(this.open ? 'chevron-down' : 'chevron-up', 16)}</button><span class="brush-strip-title">${tool.label}</span><button type="button" class="icon-button toggle" data-strip="pressure-size" aria-pressed="${pressureOn(s.dynamics, 'pressureSize')}" title="Pressure controls size" aria-label="Pressure controls size">${svg('pressure-size', 16)}</button><button type="button" class="icon-button toggle" data-strip="pressure-opacity" aria-pressed="${pressureOn(s.dynamics, 'pressureOpacity')}" title="Pressure controls opacity" aria-label="Pressure controls opacity">${svg('pressure-opacity', 16)}</button></div><div class="brush-strip-body">${rows}</div>`;
    this.el.classList.toggle('collapsed', !this.open);
  }
}
