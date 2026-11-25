CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'youtube',
  stream_ref TEXT NOT NULL,
  genre TEXT,
  energy TEXT CHECK (energy IN ('low', 'medium', 'high')),
  mood TEXT,
  themes TEXT[] NOT NULL DEFAULT '{}',
  restrictions TEXT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE songs ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'youtube';
ALTER TABLE songs ADD COLUMN IF NOT EXISTS ai_tagged_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS playlists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_songs (
  playlist_id INT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  song_id INT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  PRIMARY KEY (playlist_id, song_id)
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS context_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 0,
  condition JSONB NOT NULL DEFAULT '{}',
  filters JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  audio BYTEA,
  audio_mime TEXT,
  valid_from TIMESTAMPTZ,
  valid_to TIMESTAMPTZ,
  hour_from TIME,
  hour_to TIME,
  every_n_songs INT NOT NULL DEFAULT 3,
  last_played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  candidate_a INT NOT NULL REFERENCES songs(id),
  candidate_b INT NOT NULL REFERENCES songs(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open',
  votes_a INT,
  votes_b INT,
  winner_id INT REFERENCES songs(id),
  resolution TEXT,
  rule_name TEXT
);

CREATE TABLE IF NOT EXISTS votes (
  id SERIAL PRIMARY KEY,
  round_id INT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  song_id INT NOT NULL REFERENCES songs(id),
  voter_token TEXT NOT NULL,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, voter_token)
);

CREATE TABLE IF NOT EXISTS plays (
  id SERIAL PRIMARY KEY,
  song_id INT NOT NULL REFERENCES songs(id),
  round_id INT REFERENCES rounds(id),
  source TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS announcement_plays (
  id SERIAL PRIMARY KEY,
  announcement_id INT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);