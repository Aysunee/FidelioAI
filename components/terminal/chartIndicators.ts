// Series building + data mapping for the Terminal charts, driven by the shared ChartSettings.
//
// ChartSeriesManager owns every series of one chart instance (main price series, overlay volume and the
// indicators). `sync()` either restyles the existing series in place (colours, line widths) or, when the
// set of series / panes, the candle type or an indicator parameter changed, removes them and builds them
// again on the same chart (no refetch, no chart re-creation, visible range kept).

import {
    AreaSeries,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    LineStyle,
    customSeriesDefaultOptions,
    type AutoscaleInfoProvider,
    type CandlestickData,
    type CustomData,
    type CustomSeriesOptions,
    type CustomSeriesWhitespaceData,
    type HistogramData,
    type IChartApi,
    type ICustomSeriesPaneRenderer,
    type ICustomSeriesPaneView,
    type IPriceLine,
    type ISeriesApi,
    type LineData,
    type PaneRendererCustomData,
    type PriceFormat,
    type PriceToCoordinateConverter,
    type SeriesType,
    type Time,
    type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './types';
import { themedIndicatorColor, type ChartPalette } from './chartTheme';
import {
    isPaneIndicator,
    type BBConfig,
    type CandleType,
    type ChartSettings,
    type IndicatorConfig,
    type LineWidth,
    type MacdConfig,
    type RsiConfig,
    type StochRsiConfig,
} from './chartSettings';
import { atr, bollinger, dema, ema, heikinAshi, macd, obv, rsi, sma, stochRsi, vwap } from './indicators';

const isNum = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

type AnySeries = ISeriesApi<SeriesType>;
const asAny = (s: unknown): AnySeries => s as AnySeries;

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const parseRgb = (color: string): [number, number, number] | null => {
    const c = color.trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
    if (hex) {
        let h = hex[1];
        if (h.length === 3) h = h.split('').map((x) => x + x).join('');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(c);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};

/** `color` with the given alpha (unparseable colours are returned unchanged). */
export const withAlpha = (color: string, alpha: number): string => {
    const rgb = parseRgb(color);
    return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
};

export interface SeriesColors {
    up: string;
    down: string;
    upVolume: string;
    downVolume: string;
}

/** Candle / volume colours: the user's colours when set, otherwise the theme palette. */
export const resolveSeriesColors = (st: ChartSettings, p: ChartPalette): SeriesColors => {
    const volAlpha = p.isLight ? 0.35 : 0.45;
    return {
        up: st.upColor ?? p.up,
        down: st.downColor ?? p.down,
        upVolume: st.upColor ? withAlpha(st.upColor, volAlpha) : p.upVolume,
        downVolume: st.downColor ? withAlpha(st.downColor, volAlpha) : p.downVolume,
    };
};

/** Legend dot colour of an indicator. */
export const indicatorColor = (cfg: IndicatorConfig): string => {
    switch (cfg.type) {
        case 'bb':
            return cfg.middleColor;
        case 'stochRsi':
            return cfg.kColor;
        case 'macd':
            return cfg.macdColor;
        case 'volume':
            return cfg.maColor;
        default:
            return cfg.color;
    }
};

// ---------------------------------------------------------------------------
// Band fill: a tiny custom series that fills the area between two values.
// v5 has no built-in "fill between" series; stacking AreaSeries would paint over the candles, so a
// custom series (drawn first => underneath everything else in its pane) renders a translucent polygon
// between `upper` and `lower`. Used for the Bollinger band and the RSI / Stoch RSI zones.
// ---------------------------------------------------------------------------

interface BandPoint extends CustomData<Time> {
    upper: number;
    lower: number;
}

interface BandOptions extends CustomSeriesOptions {
    fillColor: string;
}

type DrawTarget = Parameters<ICustomSeriesPaneRenderer['draw']>[0];

class BandRenderer implements ICustomSeriesPaneRenderer {
    private data: PaneRendererCustomData<Time, BandPoint> | null = null;
    private fillColor = 'transparent';

    update(data: PaneRendererCustomData<Time, BandPoint>, options: BandOptions): void {
        this.data = data;
        this.fillColor = options.fillColor;
    }

    draw(target: DrawTarget, priceToCoordinate: PriceToCoordinateConverter): void {
        const data = this.data;
        if (!data || !data.visibleRange || data.bars.length < 2) return;
        const bars = data.bars;
        const from = Math.max(0, Math.floor(data.visibleRange.from) - 1);
        const to = Math.min(bars.length, Math.ceil(data.visibleRange.to) + 1);
        const fill = this.fillColor;

        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
            context.fillStyle = fill;
            let xs: number[] = [];
            let ups: number[] = [];
            let lows: number[] = [];

            const flush = () => {
                if (xs.length >= 2) {
                    context.beginPath();
                    context.moveTo(xs[0], ups[0]);
                    for (let i = 1; i < xs.length; i++) context.lineTo(xs[i], ups[i]);
                    for (let i = xs.length - 1; i >= 0; i--) context.lineTo(xs[i], lows[i]);
                    context.closePath();
                    context.fill();
                }
                xs = [];
                ups = [];
                lows = [];
            };

            for (let i = from; i < to; i++) {
                const bar = bars[i];
                const point = bar.originalData;
                if (!point || !isNum(point.upper) || !isNum(point.lower)) {
                    flush();
                    continue;
                }
                const yUp = priceToCoordinate(point.upper);
                const yLow = priceToCoordinate(point.lower);
                if (yUp === null || yLow === null) {
                    flush();
                    continue;
                }
                xs.push(bar.x * horizontalPixelRatio);
                ups.push(yUp * verticalPixelRatio);
                lows.push(yLow * verticalPixelRatio);
            }
            flush();
        });
    }
}

class BandSeriesView implements ICustomSeriesPaneView<Time, BandPoint, BandOptions> {
    private readonly bandRenderer = new BandRenderer();

    renderer(): ICustomSeriesPaneRenderer {
        return this.bandRenderer;
    }

    update(data: PaneRendererCustomData<Time, BandPoint>, options: BandOptions): void {
        this.bandRenderer.update(data, options);
    }

    priceValueBuilder(row: BandPoint): number[] {
        return [row.lower, row.upper];
    }

    isWhitespace(data: BandPoint | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
        const p = data as Partial<BandPoint>;
        return !(isNum(p.upper) && isNum(p.lower));
    }

    defaultOptions(): BandOptions {
        return { ...customSeriesDefaultOptions, fillColor: 'rgba(59, 130, 246, 0.1)' };
    }
}

const addBandSeries = (chart: IChartApi, fillColor: string, paneIndex: number) =>
    chart.addCustomSeries(
        new BandSeriesView(),
        { fillColor, lastValueVisible: false, priceLineVisible: false, title: '' },
        paneIndex,
    );

type BandSeries = ReturnType<typeof addBandSeries>;

// ---------------------------------------------------------------------------
// Data source & mapping helpers
// ---------------------------------------------------------------------------

/** Columnar view of the candle buffer (times already shifted to the chart's local-time axis). */
interface Source {
    n: number;
    times: UTCTimestamp[];
    sec: number[]; // raw UTC open times (VWAP day anchor)
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

const buildSource = (candles: Candle[], tzShift: number): Source => {
    const n = candles.length;
    const src: Source = {
        n,
        times: new Array<UTCTimestamp>(n),
        sec: new Array<number>(n),
        open: new Array<number>(n),
        high: new Array<number>(n),
        low: new Array<number>(n),
        close: new Array<number>(n),
        volume: new Array<number>(n),
    };
    for (let i = 0; i < n; i++) {
        const c = candles[i];
        src.times[i] = (c.time + tzShift) as UTCTimestamp;
        src.sec[i] = c.time;
        src.open[i] = c.open;
        src.high[i] = c.high;
        src.low[i] = c.low;
        src.close[i] = c.close;
        src.volume[i] = c.volume;
    }
    return src;
};

/** Applies `fn` to the finite tail of `values` (skips the NaN warm-up) and re-aligns the result. */
const applyOnFiniteTail = (values: number[], fn: (v: number[]) => number[]): number[] => {
    const out = new Array<number>(values.length).fill(NaN);
    let start = 0;
    while (start < values.length && !Number.isFinite(values[start])) start++;
    if (start >= values.length) return out;
    const res = fn(values.slice(start));
    for (let i = 0; i < res.length && start + i < out.length; i++) out[start + i] = res[i];
    return out;
};

const lineData = (src: Source, values: number[]): LineData<Time>[] => {
    const out: LineData<Time>[] = [];
    for (let i = 0; i < src.n; i++) {
        const v = values[i];
        if (isNum(v)) out.push({ time: src.times[i], value: v });
    }
    return out;
};

const updateLine = (series: ISeriesApi<'Line'>, src: Source, values: number[], i: number): void => {
    const v = values[i];
    if (isNum(v)) series.update({ time: src.times[i], value: v });
};

const bandData = (src: Source, upper: number[], lower: number[]): BandPoint[] => {
    const out: BandPoint[] = [];
    for (let i = 0; i < src.n; i++) {
        if (isNum(upper[i]) && isNum(lower[i])) out.push({ time: src.times[i], upper: upper[i], lower: lower[i] });
    }
    return out;
};

const zoneData = (src: Source, upper: number, lower: number): BandPoint[] =>
    src.times.map((time) => ({ time, upper, lower }));

const volumeColor = (src: Source, i: number, colors: SeriesColors): string =>
    src.close[i] >= src.open[i] ? colors.upVolume : colors.downVolume;

const volumeData = (src: Source, colors: SeriesColors): HistogramData<Time>[] => {
    const out: HistogramData<Time>[] = [];
    for (let i = 0; i < src.n; i++) {
        if (isNum(src.volume[i])) out.push({ time: src.times[i], value: src.volume[i], color: volumeColor(src, i, colors) });
    }
    return out;
};

const updateVolume = (series: ISeriesApi<'Histogram'>, src: Source, i: number, colors: SeriesColors): void => {
    if (isNum(src.volume[i])) series.update({ time: src.times[i], value: src.volume[i], color: volumeColor(src, i, colors) });
};

// ---------------------------------------------------------------------------
// Series options
// ---------------------------------------------------------------------------

const OSCILLATOR_RANGE: AutoscaleInfoProvider = () => ({ priceRange: { minValue: 0, maxValue: 100 } });

const overlayLine = (color: string, lineWidth: LineWidth) => ({
    color,
    lineWidth,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
});

const paneLine = (color: string, lineWidth: LineWidth, lastValueVisible = true) => ({
    color,
    lineWidth,
    lastValueVisible,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
});

const oscillatorLine = (color: string, lineWidth: LineWidth) => ({
    ...paneLine(color, lineWidth),
    priceFormat: { type: 'price' as const, precision: 2, minMove: 0.01 },
    autoscaleInfoProvider: OSCILLATOR_RANGE,
});

const VOLUME_FORMAT = { priceFormat: { type: 'volume' as const } };

const MAIN_PRICE_LINE = { priceLineStyle: LineStyle.Dotted, priceLineWidth: 1 as const };

const candleColors = (c: SeriesColors) => ({
    upColor: c.up,
    downColor: c.down,
    borderUpColor: c.up,
    borderDownColor: c.down,
    wickUpColor: c.up,
    wickDownColor: c.down,
});

const areaColors = (c: SeriesColors) => ({
    lineColor: c.up,
    topColor: withAlpha(c.up, 0.28),
    bottomColor: withAlpha(c.up, 0.02),
});

// ---------------------------------------------------------------------------
// Main price series
// ---------------------------------------------------------------------------

interface MainHandle {
    series: AnySeries;
    compute(src: Source): void;
    setData(src: Source): void;
    update(src: Source, i: number): void;
    restyle(colors: SeriesColors): void;
}

const createMain = (chart: IChartApi, type: CandleType, colors: SeriesColors): MainHandle => {
    if (type === 'line') {
        const s = chart.addSeries(LineSeries, { color: colors.up, lineWidth: 2, ...MAIN_PRICE_LINE }, 0);
        return {
            series: asAny(s),
            compute: () => undefined,
            setData: (src) => s.setData(lineData(src, src.close)),
            update: (src, i) => updateLine(s, src, src.close, i),
            restyle: (c) => s.applyOptions({ color: c.up }),
        };
    }
    if (type === 'area') {
        const s = chart.addSeries(AreaSeries, { ...areaColors(colors), lineWidth: 2, ...MAIN_PRICE_LINE }, 0);
        return {
            series: asAny(s),
            compute: () => undefined,
            setData: (src) => s.setData(lineData(src, src.close)),
            update: (src, i) => {
                if (isNum(src.close[i])) s.update({ time: src.times[i], value: src.close[i] });
            },
            restyle: (c) => s.applyOptions(areaColors(c)),
        };
    }

    const s = chart.addSeries(CandlestickSeries, { ...candleColors(colors), ...MAIN_PRICE_LINE }, 0);
    const ha = type === 'heikinAshi';
    let o: number[] = [];
    let h: number[] = [];
    let l: number[] = [];
    let c: number[] = [];
    const bar = (src: Source, i: number): CandlestickData<Time> | null =>
        isNum(o[i]) && isNum(h[i]) && isNum(l[i]) && isNum(c[i])
            ? { time: src.times[i], open: o[i], high: h[i], low: l[i], close: c[i] }
            : null;
    return {
        series: asAny(s),
        compute: (src) => {
            if (ha) {
                const r = heikinAshi(src.open, src.high, src.low, src.close);
                o = r.open;
                h = r.high;
                l = r.low;
                c = r.close;
            } else {
                o = src.open;
                h = src.high;
                l = src.low;
                c = src.close;
            }
        },
        setData: (src) => {
            const out: CandlestickData<Time>[] = [];
            for (let i = 0; i < src.n; i++) {
                const b = bar(src, i);
                if (b) out.push(b);
            }
            s.setData(out);
        },
        update: (src, i) => {
            const b = bar(src, i);
            if (b) s.update(b);
        },
        restyle: (cl) => s.applyOptions(candleColors(cl)),
    };
};

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

interface IndicatorHandle {
    pane: number;
    series: AnySeries[]; // creation order
    priceUnit: AnySeries[]; // series that follow the symbol's price precision
    scale: AnySeries | null; // pane indicators: series whose price scale is reset to auto on a symbol swap
    compute(src: Source): void;
    setData(src: Source, colors: SeriesColors): void;
    update(src: Source, i: number, isNewBar: boolean, colors: SeriesColors): void;
    /** Style-only change (same structure). `src` (current candles) is given to re-colour per-bar colours. */
    restyle(cfg: IndicatorConfig, p: ChartPalette, colors: SeriesColors, src: Source | null): void;
}

const guideLine = (series: ISeriesApi<'Line'>, price: number, p: ChartPalette): IPriceLine =>
    series.createPriceLine({
        price,
        color: p.guide,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: '',
    });

const createBB = (chart: IChartApi, cfg: BBConfig, band: BandSeries): IndicatorHandle => {
    const upper = chart.addSeries(LineSeries, overlayLine(cfg.lineColor, 1), 0);
    const lower = chart.addSeries(LineSeries, overlayLine(cfg.lineColor, 1), 0);
    const middle = chart.addSeries(LineSeries, overlayLine(cfg.middleColor, 1), 0);
    let v = { upper: [] as number[], middle: [] as number[], lower: [] as number[] };
    const all = [asAny(band), asAny(upper), asAny(lower), asAny(middle)];
    return {
        pane: 0,
        series: all,
        priceUnit: all,
        scale: null,
        compute: (src) => {
            v = bollinger(src.close, cfg.period, cfg.mult);
        },
        setData: (src) => {
            band.setData(bandData(src, v.upper, v.lower));
            upper.setData(lineData(src, v.upper));
            lower.setData(lineData(src, v.lower));
            middle.setData(lineData(src, v.middle));
        },
        update: (src, i) => {
            if (isNum(v.upper[i]) && isNum(v.lower[i])) band.update({ time: src.times[i], upper: v.upper[i], lower: v.lower[i] });
            updateLine(upper, src, v.upper, i);
            updateLine(lower, src, v.lower, i);
            updateLine(middle, src, v.middle, i);
        },
        restyle: (next) => {
            const b = next as BBConfig;
            band.applyOptions({ fillColor: b.fillColor });
            upper.applyOptions({ color: b.lineColor });
            lower.applyOptions({ color: b.lineColor });
            middle.applyOptions({ color: b.middleColor });
        },
    };
};

/** One overlay line (DEMA / EMA / SMA / VWAP). */
const createOverlayLine = (
    chart: IChartApi,
    color: string,
    lineWidth: LineWidth,
    calc: (src: Source) => number[],
): IndicatorHandle => {
    const line = chart.addSeries(LineSeries, overlayLine(color, lineWidth), 0);
    let v: number[] = [];
    return {
        pane: 0,
        series: [asAny(line)],
        priceUnit: [asAny(line)],
        scale: null,
        compute: (src) => {
            v = calc(src);
        },
        setData: (src) => line.setData(lineData(src, v)),
        update: (src, i) => updateLine(line, src, v, i),
        restyle: (next) => {
            const n = next as { color: string; lineWidth?: LineWidth };
            line.applyOptions({ color: n.color, ...(n.lineWidth ? { lineWidth: n.lineWidth } : {}) });
        },
    };
};

/** RSI / Stoch RSI: zone fill + two lines + upper/lower guides, fixed 0..100 scale. */
const createOscillator = (
    chart: IChartApi,
    pane: number,
    p: ChartPalette,
    zoneFill: (p: ChartPalette) => string,
    levels: { upper: number; lower: number },
    colors: { a: string; b: string },
    calc: (src: Source) => { a: number[]; b: number[] },
    recolor: (cfg: IndicatorConfig) => { a: string; b: string },
): IndicatorHandle => {
    const zone = addBandSeries(chart, zoneFill(p), pane);
    zone.applyOptions({ autoscaleInfoProvider: OSCILLATOR_RANGE });
    const a = chart.addSeries(LineSeries, oscillatorLine(colors.a, 2), pane);
    const b = chart.addSeries(LineSeries, oscillatorLine(colors.b, 1), pane);
    const guides = [guideLine(a, levels.upper, p), guideLine(a, levels.lower, p)];
    let v = { a: [] as number[], b: [] as number[] };
    return {
        pane,
        series: [asAny(zone), asAny(a), asAny(b)],
        priceUnit: [],
        scale: asAny(a),
        compute: (src) => {
            v = calc(src);
        },
        setData: (src) => {
            zone.setData(zoneData(src, levels.upper, levels.lower));
            a.setData(lineData(src, v.a));
            b.setData(lineData(src, v.b));
        },
        update: (src, i, isNewBar) => {
            if (isNewBar) zone.update({ time: src.times[i], upper: levels.upper, lower: levels.lower });
            updateLine(a, src, v.a, i);
            updateLine(b, src, v.b, i);
        },
        restyle: (next, pal) => {
            const c = recolor(next);
            zone.applyOptions({ fillColor: zoneFill(pal) });
            a.applyOptions({ color: c.a });
            b.applyOptions({ color: c.b });
            guides.forEach((g) => g.applyOptions({ color: pal.guide }));
        },
    };
};

const createMacd = (chart: IChartApi, cfg: MacdConfig, pane: number): IndicatorHandle => {
    const hist = chart.addSeries(HistogramSeries, { lastValueVisible: false, priceLineVisible: false }, pane);
    const line = chart.addSeries(LineSeries, paneLine(cfg.macdColor, 1), pane);
    const signal = chart.addSeries(LineSeries, paneLine(cfg.signalColor, 1), pane);
    let up = cfg.histUpColor;
    let down = cfg.histDownColor;
    let v = { macd: [] as number[], signal: [] as number[], hist: [] as number[] };
    const histData = (src: Source): HistogramData<Time>[] => {
        const out: HistogramData<Time>[] = [];
        for (let i = 0; i < src.n; i++) {
            const h = v.hist[i];
            if (isNum(h)) out.push({ time: src.times[i], value: h, color: h >= 0 ? up : down });
        }
        return out;
    };
    const all = [asAny(hist), asAny(line), asAny(signal)];
    return {
        pane,
        series: all,
        priceUnit: all,
        scale: asAny(line),
        compute: (src) => {
            v = macd(src.close, cfg.fast, cfg.slow, cfg.signal);
        },
        setData: (src) => {
            hist.setData(histData(src));
            line.setData(lineData(src, v.macd));
            signal.setData(lineData(src, v.signal));
        },
        update: (src, i) => {
            const h = v.hist[i];
            if (isNum(h)) hist.update({ time: src.times[i], value: h, color: h >= 0 ? up : down });
            updateLine(line, src, v.macd, i);
            updateLine(signal, src, v.signal, i);
        },
        restyle: (next, _p, _c, src) => {
            const m = next as MacdConfig;
            line.applyOptions({ color: m.macdColor });
            signal.applyOptions({ color: m.signalColor });
            if (m.histUpColor !== up || m.histDownColor !== down) {
                up = m.histUpColor;
                down = m.histDownColor;
                if (src && v.hist.length === src.n) hist.setData(histData(src));
            }
        },
    };
};

/** Volume pane: histogram coloured by candle direction + optional SMA. */
const createVolumePane = (chart: IChartApi, maPeriod: number, maColor: string, pane: number): IndicatorHandle => {
    const hist = chart.addSeries(HistogramSeries, { ...VOLUME_FORMAT, lastValueVisible: true, priceLineVisible: false }, pane);
    const ma = maPeriod > 0 ? chart.addSeries(LineSeries, { ...paneLine(maColor, 1, false), ...VOLUME_FORMAT }, pane) : null;
    let v: number[] = [];
    return {
        pane,
        series: ma ? [asAny(hist), asAny(ma)] : [asAny(hist)],
        priceUnit: [],
        scale: asAny(hist),
        compute: (src) => {
            v = ma ? sma(src.volume, maPeriod) : [];
        },
        setData: (src, colors) => {
            hist.setData(volumeData(src, colors));
            ma?.setData(lineData(src, v));
        },
        update: (src, i, _n, colors) => {
            updateVolume(hist, src, i, colors);
            if (ma) updateLine(ma, src, v, i);
        },
        restyle: (next, _p, colors, src) => {
            if (ma && next.type === 'volume') ma.applyOptions({ color: next.maColor });
            if (src) hist.setData(volumeData(src, colors));
        },
    };
};

/** A single line in its own pane (ATR / OBV) + optional SMA of it. */
const createPaneLine = (
    chart: IChartApi,
    pane: number,
    color: string,
    ma: { period: number; color: string } | null,
    volumeFormat: boolean,
    calc: (src: Source) => number[],
    recolor: (cfg: IndicatorConfig) => { color: string; maColor?: string },
): IndicatorHandle => {
    const fmt = volumeFormat ? VOLUME_FORMAT : {};
    const line = chart.addSeries(LineSeries, { ...paneLine(color, 1), ...fmt }, pane);
    const maLine = ma && ma.period > 0 ? chart.addSeries(LineSeries, { ...paneLine(ma.color, 1, false), ...fmt }, pane) : null;
    let v: number[] = [];
    let vMa: number[] = [];
    const all = maLine ? [asAny(line), asAny(maLine)] : [asAny(line)];
    return {
        pane,
        series: all,
        priceUnit: volumeFormat ? [] : all,
        scale: asAny(line),
        compute: (src) => {
            v = calc(src);
            vMa = maLine && ma ? applyOnFiniteTail(v, (x) => sma(x, ma.period)) : [];
        },
        setData: (src) => {
            line.setData(lineData(src, v));
            maLine?.setData(lineData(src, vMa));
        },
        update: (src, i) => {
            updateLine(line, src, v, i);
            if (maLine) updateLine(maLine, src, vMa, i);
        },
        restyle: (next) => {
            const c = recolor(next);
            line.applyOptions({ color: c.color });
            if (maLine && c.maColor) maLine.applyOptions({ color: c.maColor });
        },
    };
};

const createIndicator = (
    chart: IChartApi,
    cfg: IndicatorConfig,
    pane: number,
    p: ChartPalette,
    bbBand: BandSeries | undefined,
): IndicatorHandle | null => {
    switch (cfg.type) {
        case 'bb':
            return bbBand ? createBB(chart, cfg, bbBand) : null;
        case 'dema':
            return createOverlayLine(chart, cfg.color, cfg.lineWidth, (src) => dema(src.close, cfg.period));
        case 'ema':
            return createOverlayLine(chart, cfg.color, cfg.lineWidth, (src) => ema(src.close, cfg.period));
        case 'sma':
            return createOverlayLine(chart, cfg.color, cfg.lineWidth, (src) => sma(src.close, cfg.period));
        case 'vwap':
            return createOverlayLine(chart, cfg.color, cfg.lineWidth, (src) =>
                vwap(src.high, src.low, src.close, src.volume, src.sec),
            );
        case 'rsi':
            return createOscillator(
                chart,
                pane,
                p,
                (pal) => pal.rsiFill,
                cfg,
                { a: cfg.color, b: cfg.maColor },
                (src) => {
                    const r = rsi(src.close, cfg.period);
                    return { a: r, b: applyOnFiniteTail(r, (x) => sma(x, cfg.maPeriod)) };
                },
                (next) => ({ a: (next as RsiConfig).color, b: (next as RsiConfig).maColor }),
            );
        case 'stochRsi':
            return createOscillator(
                chart,
                pane,
                p,
                (pal) => pal.stochFill,
                cfg,
                { a: cfg.kColor, b: cfg.dColor },
                (src) => {
                    const st = stochRsi(src.close, cfg.rsiPeriod, cfg.stochPeriod, cfg.smoothK, cfg.smoothD);
                    return { a: st.k, b: st.d };
                },
                (next) => ({ a: (next as StochRsiConfig).kColor, b: (next as StochRsiConfig).dColor }),
            );
        case 'macd':
            return createMacd(chart, cfg, pane);
        case 'volume':
            return createVolumePane(chart, cfg.maPeriod, cfg.maColor, pane);
        case 'atr':
            return createPaneLine(
                chart,
                pane,
                cfg.color,
                null,
                false,
                (src) => atr(src.high, src.low, src.close, cfg.period),
                (next) => ({ color: (next as { color: string }).color }),
            );
        case 'obv':
            return createPaneLine(
                chart,
                pane,
                cfg.color,
                { period: cfg.maPeriod, color: cfg.maColor },
                true,
                (src) => obv(src.close, src.volume),
                (next) => (next.type === 'obv' ? { color: next.color, maColor: next.maColor } : { color: cfg.color }),
            );
        default:
            return null;
    }
};

/** Settings with every indicator colour as drawn on palette `p` (see themedIndicatorColor). */
const themeSettings = (st: ChartSettings, p: ChartPalette): ChartSettings => {
    if (!p.isLight) return st;
    const indicators = st.indicators.map((cfg) => {
        const out: Record<string, unknown> = { ...cfg };
        for (const [k, v] of Object.entries(cfg)) {
            if (k !== 'id' && k !== 'type' && typeof v === 'string') out[k] = themedIndicatorColor(v, p);
        }
        return out as unknown as IndicatorConfig;
    });
    return { ...st, indicators };
};

// ---------------------------------------------------------------------------
// Structure keys
// ---------------------------------------------------------------------------

const isStyleKey = (key: string): boolean => key === 'lineWidth' || key === 'color' || key.endsWith('Color');

/** Everything that decides which series / panes exist and what they compute (colours and widths excluded). */
const structureKey = (st: ChartSettings): string =>
    JSON.stringify({
        c: st.candleType,
        v: st.showVolumeOverlay,
        i: st.indicators
            .filter((cfg) => cfg.visible)
            .map((cfg) => Object.entries(cfg).filter(([k]) => k !== 'visible' && !isStyleKey(k))),
    });

const paneKeyOf = (st: ChartSettings): string =>
    st.indicators
        .filter((cfg) => cfg.visible && isPaneIndicator(cfg))
        .map((cfg) => `${cfg.type}:${cfg.id}`)
        .join('|');

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

interface BuiltIndicator {
    cfg: IndicatorConfig;
    handle: IndicatorHandle;
}

export class ChartSeriesManager {
    private readonly chart: IChartApi;
    private key: string | null = null;
    private paneKey = '';
    private main: MainHandle | null = null;
    private volume: ISeriesApi<'Histogram'> | null = null;
    private indicators: BuiltIndicator[] = [];
    private created: AnySeries[] = [];
    private colors: SeriesColors | null = null;
    private priceFormat: PriceFormat | null = null;

    constructor(chart: IChartApi) {
        this.chart = chart;
    }

    /**
     * Applies `settings` + `palette`: restyles in place when only colours / widths changed, otherwise
     * rebuilds the series on the same chart and redraws `candles` (keeping the visible range).
     */
    sync(rawSettings: ChartSettings, palette: ChartPalette, candles: Candle[], tzShift: number): void {
        const settings = themeSettings(rawSettings, palette);
        const colors = resolveSeriesColors(settings, palette);
        const key = structureKey(settings);
        if (key !== this.key || !this.main) {
            this.rebuild(settings, palette, colors, candles, tzShift);
            this.key = key;
            return;
        }
        this.colors = colors;
        const src = candles.length ? buildSource(candles, tzShift) : null;
        this.main.restyle(colors);
        if (this.volume && src) this.volume.setData(volumeData(src, colors));
        const byId = new Map(settings.indicators.map((cfg) => [cfg.id, cfg] as const));
        this.indicators.forEach((built) => {
            const next = byId.get(built.cfg.id);
            if (!next) return;
            built.cfg = next;
            try {
                built.handle.restyle(next, palette, colors, src);
            } catch {
                /* cosmetic */
            }
        });
    }

    private removeAll(): void {
        // Reverse creation order: sub panes empty (and disappear) before pane 0 does.
        for (let i = this.created.length - 1; i >= 0; i--) {
            try {
                this.chart.removeSeries(this.created[i]);
            } catch {
                /* already gone */
            }
        }
        this.created = [];
        this.indicators = [];
        this.main = null;
        this.volume = null;
    }

    private rebuild(settings: ChartSettings, palette: ChartPalette, colors: SeriesColors, candles: Candle[], tzShift: number): void {
        const chart = this.chart;
        const firstBuild = this.key === null;
        let range: { from: number; to: number } | null = null;
        if (!firstBuild && candles.length) {
            try {
                range = chart.timeScale().getVisibleLogicalRange();
            } catch {
                range = null;
            }
        }
        const paneKey = paneKeyOf(settings);
        let stretch: number[] | null = null;
        if (!firstBuild && paneKey === this.paneKey) {
            try {
                stretch = chart.panes().map((pane) => pane.getStretchFactor());
            } catch {
                stretch = null;
            }
        }

        this.removeAll();
        this.colors = colors;
        const track = <T>(s: T): T => {
            this.created.push(asAny(s));
            return s;
        };

        // Pane 0 z-order: volume, band fill, main series, overlay lines.
        if (settings.showVolumeOverlay) {
            const vol = track(
                chart.addSeries(
                    HistogramSeries,
                    { priceScaleId: 'vol', ...VOLUME_FORMAT, lastValueVisible: false, priceLineVisible: false },
                    0,
                ),
            );
            vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
            this.volume = vol;
        }

        const visible = settings.indicators.filter((cfg) => cfg.visible);
        const bands = new Map<string, BandSeries>();
        for (const cfg of visible) {
            if (cfg.type === 'bb') bands.set(cfg.id, track(addBandSeries(chart, cfg.fillColor, 0)));
        }

        const main = createMain(chart, settings.candleType, colors);
        track(main.series);
        main.series.priceScale().applyOptions({
            scaleMargins: { top: 0.08, bottom: settings.showVolumeOverlay ? 0.22 : 0.08 },
        });
        this.main = main;

        let pane = 0;
        for (const cfg of visible) {
            const paneIndex = isPaneIndicator(cfg) ? ++pane : 0;
            try {
                const handle = createIndicator(chart, cfg, paneIndex, palette, bands.get(cfg.id));
                if (!handle) continue;
                handle.series.forEach((s) => {
                    if (!this.created.includes(s)) this.created.push(s);
                });
                this.indicators.push({ cfg, handle });
            } catch {
                /* a faulty indicator must never take the price chart down with it */
            }
        }

        // Pane heights: price 3 : each sub pane 1, unless the same panes existed (keep user-resized heights).
        try {
            const panes = chart.panes();
            if (stretch && stretch.length === panes.length) {
                panes.forEach((p, i) => p.setStretchFactor(stretch![i]));
            } else {
                panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
            }
        } catch {
            /* cosmetic */
        }
        this.paneKey = paneKey;

        if (this.priceFormat) this.setPriceFormat(this.priceFormat);
        if (candles.length) {
            this.setAll(candles, tzShift);
            if (range) {
                try {
                    chart.timeScale().setVisibleLogicalRange(range);
                } catch {
                    /* cosmetic */
                }
            }
        }
    }

    /** Price precision of the symbol: main series, price overlays, MACD and ATR. */
    setPriceFormat(priceFormat: PriceFormat): void {
        this.priceFormat = priceFormat;
        try {
            this.main?.series.applyOptions({ priceFormat });
            for (const { handle } of this.indicators) handle.priceUnit.forEach((s) => s.applyOptions({ priceFormat }));
        } catch {
            /* cosmetic */
        }
    }

    /** Full redraw of `candles` (history load / rebuild). The main series throws on failure. */
    setAll(candles: Candle[], tzShift: number): void {
        const main = this.main;
        if (!main) return;
        const src = buildSource(candles, tzShift);
        const colors = this.colors as SeriesColors;
        main.compute(src);
        main.setData(src);
        this.volume?.setData(volumeData(src, colors));
        for (const { handle } of this.indicators) {
            try {
                handle.compute(src);
                handle.setData(src, colors);
            } catch {
                try {
                    handle.series.forEach((s) => s.setData([]));
                } catch {
                    /* ignore */
                }
            }
        }
    }

    /** Live tick: recompute on the whole buffer and push only the last (and, on a new bar, the previous) point. */
    updateLast(candles: Candle[], tzShift: number, isNewBar: boolean): void {
        const main = this.main;
        if (!main || !candles.length) return;
        const src = buildSource(candles, tzShift);
        const colors = this.colors as SeriesColors;
        const last = src.n - 1;
        const from = isNewBar && last > 0 ? last - 1 : last;
        main.compute(src);
        for (let i = from; i <= last; i++) {
            main.update(src, i);
            if (this.volume) updateVolume(this.volume, src, i, colors);
        }
        for (const { handle } of this.indicators) {
            try {
                handle.compute(src);
                for (let i = from; i <= last; i++) handle.update(src, i, isNewBar && i === last, colors);
            } catch {
                /* never let a single bad tick break the stream */
            }
        }
    }

    clear(): void {
        for (const s of this.created) {
            try {
                s.setData([]);
            } catch {
                /* ignore */
            }
        }
    }

    /** A different series was swapped in: let every price scale fit it again. */
    resetAutoScale(): void {
        const scales: AnySeries[] = [];
        if (this.main) scales.push(this.main.series);
        if (this.volume) scales.push(asAny(this.volume));
        for (const { handle } of this.indicators) if (handle.scale) scales.push(handle.scale);
        for (const s of scales) {
            try {
                s.priceScale().applyOptions({ autoScale: true });
            } catch {
                /* cosmetic */
            }
        }
    }
}
