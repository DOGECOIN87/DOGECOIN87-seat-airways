-- The cabin directory.
--
-- Profiles and messages used to live in localStorage, which meant a holder's
-- card existed only in the browser that typed it and an introduction was
-- never delivered to anybody. Both are rows now.
--
-- Addresses are base58 Solana public keys and are the identity throughout:
-- there are no accounts here, and a session is only ever proof that somebody
-- holds the key for the address they claim.

CREATE TABLE IF NOT EXISTS profiles (
  address      TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  role         TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  website      TEXT NOT NULL DEFAULT '',
  linkedin     TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id        TEXT PRIMARY KEY,
  sender    TEXT NOT NULL,
  recipient TEXT NOT NULL,
  body      TEXT NOT NULL,
  sent_at   TEXT NOT NULL
);

-- Both directions are read on every visit to the hub: the inbox by recipient,
-- the outbox by sender, newest first each time.
CREATE INDEX IF NOT EXISTS messages_by_recipient ON messages (recipient, sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_by_sender ON messages (sender, sent_at DESC);

-- Sessions hold a SHA-256 of the bearer token rather than the token, so a
-- dump of this table cannot be used to sign in as anybody.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);

-- One row per sign-in signature that has been spent.
--
-- A signature names a wallet and a timestamp and stays valid for five
-- minutes, so without this a captured one could be replayed for a second
-- token inside that window. An advert can afford that risk; a credential
-- cannot.
CREATE TABLE IF NOT EXISTS signins (
  address    TEXT NOT NULL,
  issued     TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (address, issued)
);

CREATE INDEX IF NOT EXISTS signins_by_expiry ON signins (expires_at);
