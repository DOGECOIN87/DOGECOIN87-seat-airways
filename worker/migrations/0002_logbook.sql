-- The logbook.
--
-- One person's notebook, kept aboard: the things heard in the cabin that
-- might be worth something later. Nothing in this table belongs to the
-- directory, nothing in it is shared with a holder, and nothing on the public
-- page reads it. It exists because alpha arrives in conversation and is lost
-- the same way — remembered for a day, and gone by the time it mattered.
--
-- Who may read it is not a column. There is exactly one wallet, named by the
-- `ADMIN_WALLET` var, and the route refuses everybody else before it reaches
-- SQL at all. That is deliberate: a permission stored as a row is a
-- permission a bug can grant, and this table has no grants in it to get wrong.

CREATE TABLE IF NOT EXISTS logbook (
  id         TEXT PRIMARY KEY,
  -- The note itself. Whatever was heard, in whatever words it was heard in.
  body       TEXT NOT NULL,
  -- Where it came from: a wallet, a handle, a room, a person. Free text,
  -- because alpha does not arrive in a schema. When it happens to be a
  -- base58 address the page resolves it against the seat map it already
  -- holds, so "who said this" reads as a seat rather than a key.
  source     TEXT NOT NULL DEFAULT '',
  -- Comma-separated, lowercased, deduplicated. What the note is about.
  tags       TEXT NOT NULL DEFAULT '',
  -- How much it is believed: 0 unrated, then 1 (heard it), 2 (plausible),
  -- 3 (acting on it). A guess recorded at the time is worth more than one
  -- reconstructed later, which is the whole reason this is a field.
  conviction INTEGER NOT NULL DEFAULT 0,
  -- open | acted | cold. A log with no way to close a line becomes a wall of
  -- text, and a wall of text is not a record of anything.
  status     TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The only ordering this is ever read in.
CREATE INDEX IF NOT EXISTS logbook_by_time ON logbook (created_at DESC);
