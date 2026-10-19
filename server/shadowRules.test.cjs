// Tests of the pure shadow rules in utils/shadowRules.ts (node:test, no DB, no network):
//   node --test server/
// The TypeScript module is bundled in memory with esbuild (the same tool build:engine uses).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

const loadShadowRules = () => {
    const { outputFiles } = esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', 'utils', 'shadowRules.ts')],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        logLevel: 'silent'
    });
    const module = { exports: {} };
    vm.runInNewContext(outputFiles[0].text, { module, exports: module.exports, require });
    return module.exports;
};

const sr = loadShadowRules();
const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 10, 12, 0); // 2026-10-10 12:00 UTC

const momentum = (symbol, at, pct, extra = {}) => ({ strategy: 'Momentum_24h_Up', symbol, side: 'BUY', price: 1.5, at, magnitude: { value: pct, text: `+${pct}%`, caption: '24s değişim' }, ...extra });
const volume = (symbol, at, extra = {}) => ({ strategy: 'Volume_Spike_4.2x', symbol, side: 'BUY', price: 1.6, at, magnitude: { value: 4.2, text: '4.2x', caption: 'hacim' }, ...extra });

test('Shadow_Confluence: momentum BUY then volume BUY within 15 min records once, with the second signal', () => {
    let state = sr.createConfluenceState();
    let r = sr.applyConfluence(state, [momentum('MAGICUSDT', T0, 9.8)], T0);
    assert.equal(r.signals.length, 0);
    assert.equal(r.state.pending.length, 1);
    r = sr.applyConfluence(r.state, [volume('MAGICUSDT', T0 + 7 * MIN)], T0 + 7 * MIN);
    assert.equal(r.signals.length, 1);
    const s = r.signals[0];
    assert.equal(s.strategy, sr.STRATEGY_SHADOW_CONFLUENCE);
    assert.equal(s.strategy, 'Shadow_Confluence');
    assert.equal(s.engine, 'SHADOW');
    assert.equal(s.source, 'ALGO_SHADOW');
    assert.equal(s.symbol, 'MAGICUSDT');
    assert.equal(s.side, 'BUY');
    assert.equal(s.price, 1.6);            // the second (volume) signal's price
    assert.equal(s.at, T0 + 7 * MIN);      // and time
    assert.match(s.note, /Gölge kural/);
    assert.match(s.note, /7 dk/);
    assert.equal(r.state.pending.length, 0);
    assert.equal(r.state.cooldowns.MAGICUSDT, T0 + 7 * MIN);
    assert.equal(r.state.lastFiredAt, T0 + 7 * MIN);
});

test('Shadow_Confluence: the order does not matter (volume first, momentum second)', () => {
    let r = sr.applyConfluence(sr.createConfluenceState(), [volume('OGNUSDT', T0)], T0);
    r = sr.applyConfluence(r.state, [momentum('OGNUSDT', T0 + 3 * MIN, 12.0)], T0 + 3 * MIN);
    assert.equal(r.signals.length, 1);
    assert.equal(r.signals[0].price, 1.5); // the momentum signal is the second one here
    assert.equal(r.signals[0].at, T0 + 3 * MIN);
});

test('Shadow_Confluence: more than 15 min apart never pairs', () => {
    let r = sr.applyConfluence(sr.createConfluenceState(), [momentum('STRKUSDT', T0, 9)], T0);
    r = sr.applyConfluence(r.state, [volume('STRKUSDT', T0 + 16 * MIN)], T0 + 16 * MIN);
    assert.equal(r.signals.length, 0);
    assert.equal(r.state.pending.length, 1, 'the stale momentum half is dropped, the volume half waits');
    assert.equal(r.state.pending[0].kind, 'volume');
});

test('Shadow_Confluence: exactly 15 min apart still pairs', () => {
    let r = sr.applyConfluence(sr.createConfluenceState(), [momentum('CFXUSDT', T0, 9)], T0);
    r = sr.applyConfluence(r.state, [volume('CFXUSDT', T0 + sr.CONFLUENCE_RULES.pairWindowMs)], T0 + sr.CONFLUENCE_RULES.pairWindowMs);
    assert.equal(r.signals.length, 1);
});

test('Shadow_Confluence: momentum of 15 % or more, or without a magnitude, never pairs', () => {
    for (const pct of [15, 15.0001, 27, 44]) {
        let r = sr.applyConfluence(sr.createConfluenceState(), [volume('CHIPUSDT', T0)], T0);
        r = sr.applyConfluence(r.state, [momentum('CHIPUSDT', T0 + 2 * MIN, pct)], T0 + 2 * MIN);
        assert.equal(r.signals.length, 0, `pct ${pct}`);
        assert.equal(r.state.pending.length, 1, 'the big momentum half is not kept');
    }
    let r = sr.applyConfluence(sr.createConfluenceState(), [momentum('CHIPUSDT', T0, 9, { magnitude: undefined })], T0);
    assert.equal(r.state.pending.length, 0);
    r = sr.applyConfluence(r.state, [volume('CHIPUSDT', T0 + MIN)], T0 + MIN);
    assert.equal(r.signals.length, 0);
    // 14.99 % pairs
    r = sr.applyConfluence(r.state, [momentum('CHIPUSDT', T0 + 2 * MIN, 14.99)], T0 + 2 * MIN);
    assert.equal(r.signals.length, 1);
});

test('Shadow_Confluence: same symbol rests 24 h, another symbol does not', () => {
    let r = sr.applyConfluence(sr.createConfluenceState(), [momentum('GTCUSDT', T0, 9)], T0);
    r = sr.applyConfluence(r.state, [volume('GTCUSDT', T0 + MIN)], T0 + MIN);
    assert.equal(r.signals.length, 1);
    // 6 h later the same pair again: nothing
    r = sr.applyConfluence(r.state, [momentum('GTCUSDT', T0 + 6 * 60 * MIN, 9), volume('GTCUSDT', T0 + 6 * 60 * MIN + MIN)], T0 + 6 * 60 * MIN + MIN);
    assert.equal(r.signals.length, 0);
    assert.equal(r.state.pending.length, 0);
    // another symbol in the same pass pairs fine
    r = sr.applyConfluence(r.state, [momentum('MAGICUSDT', T0 + 6 * 60 * MIN, 9), volume('MAGICUSDT', T0 + 6 * 60 * MIN + MIN)], T0 + 6 * 60 * MIN + MIN);
    assert.equal(r.signals.length, 1);
    assert.equal(r.signals[0].symbol, 'MAGICUSDT');
    // 24 h + 1 min after the GTC record the symbol may be recorded again
    const later = T0 + MIN + sr.CONFLUENCE_RULES.cooldownMs + MIN;
    r = sr.applyConfluence(r.state, [momentum('GTCUSDT', later, 9), volume('GTCUSDT', later + MIN)], later + MIN);
    assert.equal(r.signals.length, 1);
    assert.equal(r.state.cooldowns.GTCUSDT, later + MIN);
});

test('Shadow_Confluence: SELL, NEUTRAL, funding and two halves of the same kind never pair', () => {
    const sell = { strategy: 'Momentum_24h_Down', symbol: 'AUSDT', side: 'SELL', price: 1, at: T0, magnitude: { value: -9 } };
    const neutral = { strategy: 'Volume_Spike_3.0x', symbol: 'AUSDT', side: 'NEUTRAL', price: 1, at: T0 + MIN, magnitude: { value: 3 } };
    const funding = { strategy: 'Funding_Regime_Neg', symbol: 'AUSDT', side: 'NEUTRAL', price: 1, at: T0 + MIN, magnitude: { value: -0.1 } };
    let r = sr.applyConfluence(sr.createConfluenceState(), [sell, neutral, funding], T0 + MIN);
    assert.equal(r.signals.length, 0);
    assert.equal(r.state.pending.length, 0);
    r = sr.applyConfluence(r.state, [volume('AUSDT', T0 + 2 * MIN), volume('AUSDT', T0 + 3 * MIN)], T0 + 3 * MIN);
    assert.equal(r.signals.length, 0);
    assert.equal(r.state.pending.length, 1, 'one volume half per symbol, the newest');
    assert.equal(r.state.pending[0].at, T0 + 3 * MIN);
    assert.equal(sr.isConfluenceTrigger(sell), false);
    assert.equal(sr.isConfluenceTrigger(volume('AUSDT', T0)), true);
});

test('Shadow_Confluence: invalid price or time is ignored, state is not mutated', () => {
    const state = sr.createConfluenceState();
    const r = sr.applyConfluence(state, [momentum('BUSDT', T0, 9, { price: 0 }), momentum('CUSDT', NaN, 9)], T0);
    assert.equal(r.state.pending.length, 0);
    assert.deepEqual(state, sr.createConfluenceState());
});

test('confluenceStatus counts pending halves and records of the last 24 h', () => {
    let r = sr.applyConfluence(sr.createConfluenceState(), [momentum('DUSDT', T0, 9), momentum('EUSDT', T0, 9), volume('DUSDT', T0 + MIN)], T0 + MIN);
    const status = sr.confluenceStatus(r.state, T0 + MIN);
    // { ...status }: the bundle runs in its own vm context, so a plain copy keeps deepEqual prototype-safe.
    assert.deepEqual({ ...status }, { armed: 1, fired24h: 1, lastFiredAt: T0 + MIN });
    assert.equal(sr.confluenceStatus(r.state, T0 + 25 * 60 * MIN).fired24h, 0);
});

test('Shadow_SqueezeFuel is untouched: its trigger / arming still work beside the new rule', () => {
    const perps = new Set(['MAGICUSDT']);
    const r = sr.armSqueezeFuel(sr.createSqueezeFuelState(), [momentum('MAGICUSDT', T0, 9)], perps, T0);
    assert.equal(r.armed.length, 1);
    assert.equal(sr.STRATEGY_SHADOW_SQUEEZE_FUEL, 'Shadow_SqueezeFuel');
});
