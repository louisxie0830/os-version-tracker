// Trend chart behaviour, around the server-rendered SVG charts (render-chart.ts), which draw without script:
// - <chart-switch>: a trend card; a choice-change from a choice-chips inside it shows the elements of that
//   group (data-chart-group = the chips' name) whose data-value was chosen, and hides the others
// - <line-chart>: one chart; a crosshair and a tooltip with every series' value for the month under the pointer
if (!customElements.get('chart-switch')) {
  customElements.define('chart-switch', class extends HTMLElement {
    #ready = false;

    connectedCallback(): void {
      if (this.#ready) return;
      this.#ready = true;
      this.addEventListener('choice-change', event => {
        const { name, value } = event.detail ?? {};
        if (!name) return;
        for (const el of this.querySelectorAll<HTMLElement>('[data-chart-group]')) {
          if (el.dataset.chartGroup === name) el.hidden = el.dataset.value !== value;
        }
      });
    }
  });
}

if (!customElements.get('line-chart')) {
  /** The figure's data-chart JSON (render-chart.ts): month labels, and per series its colour slot and values */
  interface ChartData {
    x: string[];
    unit: string;
    series: Array<{ name: string; slot: number | 'other'; values: Array<number | null> }>;
  }

  const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  customElements.define('line-chart', class extends HTMLElement {
    #ready = false;

    connectedCallback(): void {
      if (this.#ready) return;
      const figure = this.querySelector<HTMLElement>('figure.chart[data-chart]');
      const svg = figure?.querySelector('svg');
      const cross = figure?.querySelector('.chart-cross');
      const tip = figure?.querySelector<HTMLElement>('.chart-tip');
      const plot = figure?.querySelector('.chart-plot');
      if (!figure || !svg || !cross || !tip || !plot) return;
      let data: ChartData;
      try { data = JSON.parse(figure.dataset.chart ?? '') as ChartData; } catch { return; }
      this.#ready = true;
      const show = (rect: SVGElement): void => {
        const i = Number(rect.dataset.i);
        const cx = Number(rect.dataset.cx);
        cross.setAttribute('x1', String(cx));
        cross.setAttribute('x2', String(cx));
        cross.setAttribute('visibility', 'visible');
        tip.replaceChildren();
        const title = document.createElement('strong');
        title.textContent = data.x[i];
        tip.append(title);
        for (const s of data.series) {
          const row = document.createElement('div');
          const swatch = document.createElement('span');
          swatch.className = `chart-swatch series-${s.slot}`;
          const name = document.createElement('span');
          name.textContent = s.name;
          const value = document.createElement('span');
          const v = s.values[i];
          value.textContent = v == null ? '—' : `${fmt(v)}${data.unit}`;
          row.append(swatch, name, value);
          tip.append(row);
        }
        tip.hidden = false;
        // Beside the crosshair, flipped to the left near the right edge
        const box = plot.getBoundingClientRect();
        const x = (cx / svg.viewBox.baseVal.width) * box.width;
        const left = x + 12 + tip.offsetWidth > box.width ? x - 12 - tip.offsetWidth : x + 12;
        tip.style.left = `${Math.max(0, left)}px`;
      };
      svg.addEventListener('pointerover', event => { if (event.target instanceof SVGElement && event.target.classList.contains('chart-hit')) show(event.target); });
      svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
    }
  });
}
