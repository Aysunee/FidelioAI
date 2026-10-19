// Tests of the pure scorecard statistics in server/outcomes.cjs (node:test, no DB, no network):
//   node --test server/
const test = require('node:test');
const assert = require('node:assert/strict');
const o = require('./outcomes.cjs');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const T0 = Date.UTC(2026, 9, 1); // 2026-10-01 00:00 UTC

const close = (actual, expected, eps = 1e-9) =>
    assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected}`);

// Directional sample: one signal measured at t0 with a gross return `ret` (spot cost 0.2 %).
const sample = (t0, ret, extra = {}) => ({ t0, raw: ret, ret, net: ret - 0.002, excess: ret, mfe: ret, mae: 0, ...extra });

// A family with `days` days of `perDay` signals a day, two hours apart; `retOf(day, k)` gives the gross return.
const grid = (days, perDay, retOf) => {
    const out = [];
    for (let d = 0; d < days; d++) {
        for (let k = 0; k < perDay; k++) out.push(sample(T0 + d * DAY_MS + k * 2 * HOUR_MS, retOf(d, k)));
    }
    return out;
};

// ---- day-clustered t ----
test('clusteredT: averages per bucket, so a burst in one bucket is one observation', () => {
    // Three days: 1 value, 10 values, 1 value. Day means 0.01, 0.02, 0.03 -> t = 0.02 / (0.01 / sqrt(3)).
    const values = [
        { t: T0, x: 0.01 },
        ...Array.from({ length: 10 }, (_, i) => ({ t: T0 + DAY_MS + i * HOUR_MS, x: 0.02 })),
        { t: T0 + 2 * DAY_MS, x: 0.03 }
    ];
    close(o.clusteredT(values, DAY_MS), 0.02 / (0.01 / Math.sqrt(3)));
});

test('clusteredT: null below two buckets or without spread', () => {
    assert.equal(o.clusteredT([{ t: T0, x: 1 }, { t: T0 + HOUR_MS, x: 2 }], DAY_MS), null);
    assert.equal(o.clusteredT([{ t: T0, x: 1 }, { t: T0 + DAY_MS, x: 1 }], DAY_MS), null);
    assert.equal(o.clusteredT([], DAY_MS), null);
});

test('two rally days among ten flat days: hour-clustered t passes 2, day-clustered t does not', () => {
    // 12 days x 10 signals; days 0 and 5 gain 50 %, the others lose ~1 % (the live pattern of October 2026).
    const samples = grid(12, 10, (d, k) => (d % 5 === 0 ? 0.5 : -0.01) + (k % 2 ? 0.003 : -0.002));
    const stats = o.computeStats(samples, { minutes: 1440 });
    assert.equal(stats.cluster, 'day');
    assert.equal(stats.nHours, 120);
    assert.equal(stats.nDays, 12);
    assert.equal(stats.nEff, 12);
    assert.ok(stats.tStatHour > 2, `tStatHour ${stats.tStatHour}`);
    assert.ok(stats.tStatDay < 2, `tStatDay ${stats.tStatDay}`);
    assert.equal(stats.tStat, stats.tStatDay);
    assert.equal(stats.verdict, 'SCREEN');
});

test('computeStats: 15 m and 1 h keep the hour cluster, 4 h and 24 h use the UTC day', () => {
    const samples = grid(3, 4, () => 0.01);
    assert.equal(o.computeStats(samples, { minutes: 15 }).cluster, 'hour');
    assert.equal(o.computeStats(samples, { minutes: 60 }).cluster, 'hour');
    assert.equal(o.computeStats(samples, { minutes: 240 }).cluster, 'day');
    assert.equal(o.computeStats(samples, { minutes: 1440 }).cluster, 'day');
    assert.equal(o.computeStats(samples, { minutes: 60 }).nEff, 12);
    assert.equal(o.computeStats(samples, { minutes: 240 }).nEff, 3);
    close(o.computeStats(samples, { minutes: 240 }).spanDays, 2 + 6 / 24);
});

// ---- robust means ----
test('winsorizedMean: 5 % of each tail is pulled in; below 20 values it is the mean', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20, mean 10.5
    xs[19] = 1000; // one outlier
    // k = 1: the 1000 becomes 19 and the 1 becomes 2 -> (2 + 2 + 3 + ... + 19 + 19) / 20
    const expected = (2 + 2 + (3 + 19) * 17 / 2 + 19) / 20;
    close(o.winsorizedMean(xs), expected);
    close(o.winsorizedMean([1, 2, 1000]), (1 + 2 + 1000) / 3);
    assert.equal(o.winsorizedMean([]), null);
});

test('trimmedTopMean leaves out the three largest; meanLog averages log(1 + x)', () => {
    close(o.trimmedTopMean([5, 1, 100, 2, 50, 70]), (1 + 2 + 5) / 3);
    assert.equal(o.trimmedTopMean([1, 2, 3]), null);
    close(o.meanLog([1, -0.5]), 0); // +100 % and −50 % cancel out in log space
    close(o.meanLog([1, -0.5, -1]), 0); // −100 % is left out
    assert.equal(o.meanLog([]), null);
});

test('sameSign', () => {
    assert.equal(o.sameSign(0.1, 0.2), true);
    assert.equal(o.sameSign(-0.1, -2), true);
    assert.equal(o.sameSign(0.1, -0.2), false);
    assert.equal(o.sameSign(0, 0), true);
    assert.equal(o.sameSign(0.1, 0), false);
    assert.equal(o.sameSign(null, 1), false);
});

test('a mean that hangs on one +100 % gain is OUTLIER', () => {
    // 110 signals, one per hour: 109 small losses and one +100 %. Mean positive, winsorized mean negative.
    const samples = Array.from({ length: 110 }, (_, i) => sample(T0 + i * HOUR_MS, i === 0 ? 1 : -0.005));
    const stats = o.computeStats(samples, { minutes: 60 });
    assert.ok(stats.meanNet > 0);
    assert.ok(stats.meanNetWinsor < 0);
    assert.equal(stats.outlierDependent, true);
    assert.equal(stats.verdict, 'OUTLIER');
});

// ---- cost sensitivity and EW-alt ----
test('costSensitivity reports the gross mean at 0.2 / 0.4 / 0.6 % round trip', () => {
    const stats = o.computeStats(grid(2, 2, () => 0.01), { minutes: 60 });
    assert.deepEqual(stats.costSensitivity.map(c => c.cost), [0.002, 0.004, 0.006]);
    close(stats.costSensitivity[0].meanNet, 0.008);
    close(stats.costSensitivity[1].meanNet, 0.006);
    close(stats.costSensitivity[2].meanNet, 0.004);
});

test('buildScorecard: the EW-alt excess compares a signal with every signal of the same hour and horizon', () => {
    const horizon = (raw, dir) => JSON.stringify({ raw, ret: dir * raw, net: dir * raw - 0.002, excess: dir * raw, mfe: 0, mae: 0, btc: 0 });
    const row = (id, strategy, side, t0, raw) => {
        const dir = side === 'SELL' ? -1 : 1;
        const h = horizon(raw, dir);
        return { signal_id: id, symbol: 'X', market: 'spot', side, strategy, engine: 'MOMENTUM', source: 'ALGO_MOMENTUM', t0, status: 'done', o15: h, o60: h, o240: h, o1440: h };
    };
    // Same hour: momentum BUY +5 %, a volume BUY +1 %, a momentum SELL whose coin rose 3 %. EW-alt raw = 3 %.
    const rows = [
        row('a', 'Momentum_24h_Up', 'BUY', T0, 0.05),
        row('b', 'Volume_Spike_Up', 'BUY', T0 + 10 * 60 * 1000, 0.01),
        row('c', 'Momentum_24h_Down', 'SELL', T0 + 20 * 60 * 1000, 0.03)
    ];
    const sc = o.buildScorecard(rows, { days: 7, now: T0 + DAY_MS });
    const up = sc.rows.find(r => r.key === 'Momentum_24h_Up').byHorizon['1h'];
    const down = sc.rows.find(r => r.key === 'Momentum_24h_Down').byHorizon['1h'];
    close(up.meanExcessAlt, 0.05 - 0.03);
    close(down.meanExcessAlt, -(0.03 - 0.03));
    close(up.meanExcess, 0.05); // the BTC comparison stays
    assert.deepEqual(sc.costSensitivity, [0.002, 0.004, 0.006]);
    assert.equal(sc.minVerifiedDays, 90);
});

// ---- tiers ----
const base = { neutral: false, nHours: 120, tStat: 2.5, tStatHour: 2.5, tStatDay: 2.5, meanNet: 0.01, meanNetWinsor: 0.009, meanNetTrimTop: 0.008, meanLogNet: 0.0095, spanDays: 100 };

test('verdictFor: sample-size gates count signal hours', () => {
    assert.equal(o.verdictFor({ ...base, nHours: 12 }).verdict, 'COLLECTING');
    assert.equal(o.verdictFor({ ...base, nHours: 12 }).verdictText, 'Veri toplanıyor (12/30 saat)');
    assert.equal(o.verdictFor({ ...base, nHours: 99 }).verdict, 'EARLY');
    assert.equal(o.verdictFor({ neutral: true }).verdict, 'NEUTRAL');
});

test('verdictFor: Tarama needs the hour-clustered t >= 2 only', () => {
    assert.equal(o.verdictFor({ ...base, tStatDay: 1.2 }).verdict, 'SCREEN');
    assert.equal(o.verdictFor({ ...base, tStatDay: null }).verdict, 'SCREEN');
    assert.equal(o.verdictFor({ ...base, tStatHour: 1.9, tStat: 1.9 }).verdict, 'NO_EDGE');
    assert.equal(o.verdictFor({ ...base, tStat: -2.1, tStatHour: -2.1, tStatDay: -1, meanNet: -0.01, meanNetWinsor: -0.01 }).verdict, 'REVERSE');
});

test('verdictFor: Aday needs the day-clustered t >= 2 and robust means of the same sign', () => {
    assert.equal(o.verdictFor({ ...base, spanDays: 30 }).verdict, 'CANDIDATE');
    assert.equal(o.verdictFor({ ...base, spanDays: 30, meanNetTrimTop: -0.001 }).verdict, 'SCREEN');
    assert.equal(o.verdictFor({ ...base, spanDays: 30, meanLogNet: -0.001 }).verdict, 'SCREEN');
    assert.equal(o.verdictFor({ ...base, meanNetWinsor: -0.001 }).verdict, 'OUTLIER');
});

test('verdictFor: Doğrulanmış needs day-clustered t >= 3 and a window of at least 90 days', () => {
    assert.equal(o.verdictFor({ ...base, tStatDay: 3.2, spanDays: 90 }).verdict, 'VERIFIED');
    assert.equal(o.verdictFor({ ...base, tStatDay: 3.2, spanDays: 89.9 }).verdict, 'CANDIDATE');
    assert.equal(o.verdictFor({ ...base, tStatDay: 2.9, spanDays: 200 }).verdict, 'CANDIDATE');
    assert.equal(o.verdictFor({ ...base, tStatDay: 3.2, spanDays: null }).verdict, 'CANDIDATE');
});

test('computeStats never returns VERIFIED below 90 days of samples', () => {
    // 60 days x 4 signals, strong and steady gains: day-clustered t is far above 3, but the window is short.
    const samples = grid(60, 4, (d, k) => 0.02 + (k % 2 ? 0.002 : -0.002) + (d % 2 ? 0.001 : -0.001));
    const stats = o.computeStats(samples, { minutes: 1440 });
    assert.ok(stats.tStatDay > 3, `tStatDay ${stats.tStatDay}`);
    assert.equal(stats.verdict, 'CANDIDATE');
    // The same pattern over 91 days qualifies.
    const long = o.computeStats(grid(91, 4, (d, k) => 0.02 + (k % 2 ? 0.002 : -0.002) + (d % 2 ? 0.001 : -0.001)), { minutes: 1440 });
    assert.equal(long.verdict, 'VERIFIED');
});

test('neutral stats carry the new fields as null', () => {
    const stats = o.computeStats([{ t0: T0, raw: 0.01, net: null, mfe: 0.01, mae: -0.01 }], { neutral: true, minutes: 240 });
    assert.equal(stats.verdict, 'NEUTRAL');
    assert.equal(stats.cluster, 'day');
    assert.equal(stats.tStatDay, null);
    assert.equal(stats.meanNetWinsor, null);
    assert.equal(stats.meanExcessAlt, null);
    assert.equal(stats.outlierDependent, false);
    assert.deepEqual(stats.costSensitivity.map(c => c.meanNet), [null, null, null]);
});

// ---- shadow families ----
test('Shadow_Confluence is a fixed shadow family that closes the scorecard after the base rows', () => {
    const horizon = JSON.stringify({ raw: 0.02, ret: 0.02, net: 0.018, excess: 0.02, mfe: 0.02, mae: 0, btc: 0 });
    const row = (id, strategy, engine, source, t0) => ({ signal_id: id, symbol: 'MAGICUSDT', market: 'spot', side: 'BUY', strategy, engine, source, t0, status: 'done', o15: horizon, o60: horizon, o240: horizon, o1440: horizon });
    const rows = [
        row('shadow_c1', 'Shadow_Confluence', 'SHADOW', 'ALGO_SHADOW', T0),
        row('shadow_s1', 'Shadow_SqueezeFuel', 'SHADOW', 'ALGO_SHADOW', T0 + HOUR_MS),
        row('m1', 'Momentum_24h_Up', 'MOMENTUM', 'ALGO_MOMENTUM', T0 + 2 * HOUR_MS)
    ];
    const sc = o.buildScorecard(rows, { days: 7, now: T0 + DAY_MS });
    const confluence = sc.rows.find(r => r.key === 'Shadow_Confluence');
    assert.ok(confluence, 'Shadow_Confluence row missing');
    assert.equal(confluence.shadow, true);
    assert.equal(confluence.engine, 'SHADOW');
    assert.equal(confluence.side, 'BUY');
    assert.equal(confluence.label, 'Gölge · Momentum + hacim çakışması');
    assert.equal(confluence.total, 1);
    const def = o.FIXED_FAMILIES.find(f => f.key === 'Shadow_Confluence');
    assert.ok(def && def.shadow === true && def.family === 'Shadow_Confluence');
    // Shadow rows come last, squeeze fuel before confluence (FIXED_FAMILIES order); base rows first.
    const keys = sc.rows.map(r => r.key);
    assert.ok(keys.indexOf('Momentum_24h_Up') < keys.indexOf('Shadow_SqueezeFuel'));
    assert.ok(keys.indexOf('Shadow_SqueezeFuel') < keys.indexOf('Shadow_Confluence'));
    assert.equal(sc.rows.find(r => r.key === 'Shadow_SqueezeFuel').shadow, true);
});

// ---- registration of TradingView webhook signals (no DB, no network: fake pool + fake fetch) ----

const EXCHANGE_INFO = JSON.stringify({ symbols: [{ symbol: 'BTCUSDT', status: 'TRADING' }, { symbol: 'ETHUSDT', status: 'TRADING' }] });
const fakeFetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => JSON.parse(EXCHANGE_INFO) });

// A fake mysql2 pool: records every query; `signals` rows are served to the backfill SELECT with the same
// string comparison MySQL applies to the VARCHAR `time` column; inserts land in `outcomes`.
const fakeDb = (signals = []) => {
    const db = { queries: [], outcomes: [] };
    db.query = async (sql, params = []) => {
        db.queries.push({ sql, params });
        if (sql.startsWith('INSERT INTO signal_outcomes')) {
            if (db.outcomes.some(r => r.signalId === params[0])) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
            db.outcomes.push({ signalId: params[0], symbol: params[1], market: params[2], side: params[3], strategy: params[4], engine: params[5], source: params[6], t0: params[7], p0: params[8], status: params[10] });
            return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('SELECT id, strategy, symbol')) {
            const [from, limit] = params;
            return [signals.filter(s => s.time >= from).sort((a, b) => (a.time < b.time ? 1 : -1)).slice(0, limit)];
        }
        if (sql.startsWith('SELECT signal_id FROM signal_outcomes WHERE signal_id IN')) {
            return [db.outcomes.filter(r => params.includes(r.signalId)).map(r => ({ signal_id: r.signalId }))];
        }
        return [[]];
    };
    return db;
};

const tracker = (db, extra = {}) => o.createOutcomeTracker({
    db, fetch: fakeFetch, now: () => T0, isLeader: () => true, hasTimeMs: async () => false,
    log: { info() {}, warn() {} }, ...extra
});

test('buildRegistration: a TradingView webhook symbol (BINANCE:BTCUSDT.P) is a pending perp row with engine null', () => {
    const d = o.buildRegistration({ id: 'w1', strategy: 'External_Webhook', symbol: 'BINANCE:BTCUSDT.P', side: 'BUY', price: 50000, source: 'WEBHOOK', timeMs: T0 });
    assert.equal(d.status, 'pending');
    assert.equal(d.symbol, 'BTCUSDT');
    assert.equal(d.market, 'perp');
    assert.equal(d.engine, null);
    assert.equal(d.source, 'WEBHOOK');
    assert.equal(d.t0, T0);
    const spot = o.buildRegistration({ id: 'w2', strategy: 'External_Webhook', symbol: 'ETHUSDT', side: 'SELL', price: 3000, source: 'WEBHOOK', time: new Date(T0).toISOString() });
    assert.equal(spot.status, 'pending');
    assert.equal(spot.market, 'spot');
    assert.equal(spot.t0, T0); // no time_ms column: the ISO `time` string is parsed
});

test('register: the webhook publish path opens a signal_outcomes row (source WEBHOOK, engine NULL)', async () => {
    const db = fakeDb();
    const t = tracker(db);
    t.setTable(true);
    const signal = { id: 'wh-1', strategy: 'External_Webhook', symbol: 'BINANCE:BTCUSDT.P', side: 'BUY', price: 50000, time: new Date(T0).toISOString(), note: 'Received via Webhook', source: 'WEBHOOK', confidence: 0.95 };
    const draft = await t.register({ ...signal, timeMs: T0 });
    assert.ok(draft, 'row inserted');
    assert.equal(db.outcomes.length, 1);
    assert.deepEqual({ ...db.outcomes[0] }, { signalId: 'wh-1', symbol: 'BTCUSDT', market: 'perp', side: 'BUY', strategy: 'External_Webhook', engine: null, source: 'WEBHOOK', t0: T0, p0: 50000, status: 'pending' });
    assert.equal(await t.register({ ...signal, timeMs: T0 }), null); // idempotent
});

test('backfill without signals.time_ms: ISO string window of 7 days; signals older than that are never registered', async () => {
    const iso = (ms) => new Date(ms).toISOString();
    const row = (id, ms, source = 'WEBHOOK') => ({ id, strategy: 'External_Webhook', symbol: 'BINANCE:ETHUSDT.P', side: 'BUY', price: 3000, time: iso(ms), source });
    const db = fakeDb([row('burst', T0 - 7 * DAY_MS - HOUR_MS), row('recent', T0 - DAY_MS, 'ALGO_MOMENTUM')]);
    const result = await tracker(db).backfill();
    const select = db.queries.find(q => q.sql.startsWith('SELECT id, strategy, symbol'));
    assert.match(select.sql, /WHERE time >= \?/);
    assert.doesNotMatch(select.sql, /time_ms/);
    assert.equal(select.params[0], iso(T0 - 7 * DAY_MS));
    assert.equal(select.params[1], 5000);
    assert.deepEqual(result, { at: T0, scanned: 1, inserted: 1 });
    assert.deepEqual(db.outcomes.map(r => r.signalId), ['recent']);
});

test('backfill: OUTCOMES_BACKFILL_DAYS / _MAX_ROWS widen the window (deps override the env)', async () => {
    const iso = (ms) => new Date(ms).toISOString();
    const row = (id, ms) => ({ id, strategy: 'External_Webhook', symbol: 'ETHUSDT', side: 'BUY', price: 3000, time: iso(ms), source: 'WEBHOOK' });
    const db = fakeDb([row('burst', T0 - 7 * DAY_MS - HOUR_MS), row('recent', T0 - DAY_MS)]);
    const result = await tracker(db, { backfillDays: 30, backfillMaxRows: 1 }).backfill();
    const select = db.queries.find(q => q.sql.startsWith('SELECT id, strategy, symbol'));
    assert.equal(select.params[0], iso(T0 - 30 * DAY_MS));
    assert.equal(select.params[1], 1);
    assert.deepEqual(result, { at: T0, scanned: 1, inserted: 1 });
    assert.deepEqual(db.outcomes.map(r => r.signalId), ['recent']); // newest first under the row cap
});

test('parseBackfillConfig: defaults 7 days / 5000 rows, env integers within bounds, garbage ignored', () => {
    assert.deepEqual(o.parseBackfillConfig({}), { days: 7, maxRows: 5000 });
    assert.deepEqual(o.parseBackfillConfig({ OUTCOMES_BACKFILL_DAYS: '30', OUTCOMES_BACKFILL_MAX_ROWS: '20000' }), { days: 30, maxRows: 20000 });
    assert.deepEqual(o.parseBackfillConfig({ OUTCOMES_BACKFILL_DAYS: '0', OUTCOMES_BACKFILL_MAX_ROWS: 'çok' }), { days: 7, maxRows: 5000 });
    assert.deepEqual(o.parseBackfillConfig({ OUTCOMES_BACKFILL_DAYS: '400', OUTCOMES_BACKFILL_MAX_ROWS: '999999' }), { days: 90, maxRows: 50000 });
});
