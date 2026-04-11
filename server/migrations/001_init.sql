CREATE TABLE IF NOT EXISTS signals (
  id           TEXT PRIMARY KEY,
  strategy     TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  side         TEXT NOT NULL CHECK (side IN ('BUY','SELL','LONG','SHORT')),
  price        NUMERIC NOT NULL,
  time         TIMESTAMPTZ NOT NULL,
  note         TEXT,
  source       TEXT DEFAULT 'WEBHOOK',
  confidence   NUMERIC DEFAULT 0.95,
  received_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_time   ON signals (time DESC);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals (symbol);
CREATE INDEX IF NOT EXISTS idx_signals_source ON signals (source);
