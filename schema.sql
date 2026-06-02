-- Run once against your Neon database (psql or the Neon SQL editor).
-- Single-user personal app: one key-value table mirrors the app's storage layer,
-- so the frontend barely changes. Values are the same JSON strings the app already
-- writes (keys like 'golf:bag2', 'golf:course2', 'golf:rounds', 'golf:curRound').
create table if not exists kv (
  k          text primary key,
  v          text not null,
  updated_at timestamptz default now()
);

-- If you later want multi-device or multiple players, add a user_id and make the
-- primary key (user_id, k). For just you, the above is enough.
