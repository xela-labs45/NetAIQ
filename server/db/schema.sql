CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS segments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  cidr TEXT NOT NULL,
  description TEXT,
  color TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  hostname TEXT,
  ip_address TEXT UNIQUE NOT NULL,
  mac_address TEXT,
  device_type TEXT,
  is_critical INTEGER DEFAULT 0,
  segment_id INTEGER REFERENCES segments(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(ip_address);
CREATE INDEX IF NOT EXISTS idx_devices_mac ON devices(mac_address);

CREATE TABLE IF NOT EXISTS ping_history (
  id INTEGER PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL,
  latency_ms REAL,
  packet_loss REAL
);

-- Index for fast queries on ping_history
CREATE INDEX IF NOT EXISTS idx_ping_history_device_id ON ping_history(device_id);
CREATE INDEX IF NOT EXISTS idx_ping_history_timestamp ON ping_history(timestamp);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL,
  is_read INTEGER DEFAULT 0,
  email_sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_device_id ON alerts(device_id);
CREATE INDEX IF NOT EXISTS idx_alerts_is_read ON alerts(is_read);

CREATE TABLE IF NOT EXISTS scan_results (
  id INTEGER PRIMARY KEY,
  segment_id INTEGER REFERENCES segments(id) ON DELETE CASCADE,
  scanned_at TEXT DEFAULT CURRENT_TIMESTAMP,
  hosts_found INTEGER,
  hosts_up INTEGER,
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ai_device_identifications (
  id INTEGER PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  mac_address TEXT,
  device_type_suggestion TEXT,
  manufacturer TEXT,
  os_guess TEXT,
  owner_type TEXT,
  confidence TEXT,
  reasoning TEXT,
  suggested_name TEXT,
  raw_response TEXT,
  provider TEXT,
  model TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_analysis_history (
  id INTEGER PRIMARY KEY,
  analysis_type TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  result_json TEXT,
  health_score INTEGER,
  anomaly_count INTEGER,
  alert_count INTEGER,
  urgent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_device_id ON ai_device_identifications(device_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_type ON ai_analysis_history(analysis_type);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_created ON ai_analysis_history(created_at);

