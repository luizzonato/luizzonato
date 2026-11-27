-- Marca "pago" (ou "recebido", nas rendas) por lançamento, por mês e por pessoa:
-- numa conta dividida, cada um marca a própria parte.
CREATE TABLE payments (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entry_id, month, user_id)
);
