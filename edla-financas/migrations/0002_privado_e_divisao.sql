-- is_private: 1 = só quem é "dono" (Luiz) vê o lançamento.
-- split_pct: parte de quem lançou (1..99). NULL = conta só de quem lançou. O resto (100 - split_pct) é do parceiro(a).
ALTER TABLE entries ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1));
ALTER TABLE entries ADD COLUMN split_pct INTEGER CHECK (split_pct IS NULL OR (split_pct BETWEEN 1 AND 99));
