-- Presença: última vez que a pessoa esteve com o app aberto (segundos) e se ela quer aparecer online.
ALTER TABLE users ADD COLUMN last_seen INTEGER;
ALTER TABLE users ADD COLUMN show_online INTEGER NOT NULL DEFAULT 1 CHECK (show_online IN (0, 1));
