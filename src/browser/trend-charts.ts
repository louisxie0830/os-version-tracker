// Trend chart behaviour, around the server-rendered SVG charts (render-chart.ts), which draw without script:
// - <chart-switch>: a trend card; a choice-change from a choice-chips inside it shows the elements of that
//   group (data-chart-group = the chips' name) whose data-value was chosen, and hides the others
// - <line-chart>: one chart; a crosshair and a tooltip with every series' value for the month under the
//   pointer, or, with the chart focused, the month chosen with the arrow keys (Home / End: first / last).
//   The tooltip is hidden from assistive technology, which has the chart's table instead.
defineElement('chart-switch', class extends LightElement {
  protected setup(signal: AbortSignal): void {
    this.addEventListener('choice-change', event => {
      const { name, value } = event.detail ?? {};
      if (!name) return;
      for (const el of this.querySelectorAll<HTMLElement>('[data-chart-group]')) {
        if (el.dataset.chartGroup === name) el.hidden = el.dataset.value !== value;
      }
    }, { signal });
  }
});

{
  /** The figure's data-chart JSON (render-chart.ts): month labels, and per series its colour slot and values */
  interface ChartData {
    x: string[];
    unit: string;
    series: Array<{ name: string; slot: number | 'other'; values: Array<number | null> }>;
  }

  const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  defineElement('line-chart', class extends LightElement {
    protected setup(signal: AbortSignal): boolean {
      const figure = this.querySelector<HTMLElement>('figure.chart[data-chart]');
      const svg = figure?.querySelector('svg');
      const cross = figure?.querySelector('.chart-cross');
      const tip = figure?.querySelector<HTMLElement>('.chart-tip');
      const plot = figure?.querySelector('.chart-plot');
      if (!figure || !svg || !cross || !tip || !plot) return false;
      let data: ChartData;
      try { data = JSON.parse(figure.dataset.chart ?? '') as ChartData; } catch { return false; }
      const hits = [...svg.querySelectorAll<SVGElement>('.chart-hit')];
      /** The month shown, -1 when none */
      let current = -1;
      const show = (i: number): void => {
        const hit = hits[i];
        // Moving within the same month's band changes nothing: no rebuild, no layout read
        if (!hit || (i === current && !tip.hidden)) return;
        current = i;
        const cx = Number(hit.dataset.cx);
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
      const hide = (): void => {
        tip.hidden = true;
        cross.setAttribute('visibility', 'hidden');
      };
      svg.addEventListener('pointerover', event => {
        if (event.target instanceof SVGElement && event.target.classList.contains('chart-hit')) show(Number(event.target.dataset.i));
      }, { signal });
      svg.addEventListener('pointerleave', hide, { signal });
      if (hits.length) {
        svg.setAttribute('tabindex', '0');
        svg.addEventListener('focus', () => show(current >= 0 ? current : hits.length - 1), { signal });
        svg.addEventListener('blur', hide, { signal });
        svg.addEventListener('keydown', event => {
          const next = ({ ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: hits.length - 1 } as Record<string, number>)[event.key];
          if (next === undefined) return;
          event.preventDefault();
          show(Math.max(0, Math.min(hits.length - 1, next)));
        }, { signal });
      }
      return true;
    }
  });
}
