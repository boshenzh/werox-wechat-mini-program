-- WeRox event album migration (low risk / rollback friendly)
-- Execute in phases: detect -> create -> verify -> rule -> validate

-- [Phase 1] Read-only detection
-- SHOW TABLES LIKE 'event_album_photos';

-- [Phase 2] Create table
CREATE TABLE IF NOT EXISTS event_album_photos (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  _openid VARCHAR(64) DEFAULT '' NOT NULL,
  event_id INT NOT NULL,
  uploader_user_id BIGINT NULL,
  uploader_openid VARCHAR(64) NOT NULL,
  uploader_role VARCHAR(32) NOT NULL DEFAULT 'runner',
  file_id VARCHAR(500) NOT NULL,
  thumb_file_id VARCHAR(500) NULL,
  file_path VARCHAR(500) NULL,
  mime_type VARCHAR(64) NULL,
  width INT NULL,
  height INT NULL,
  size_bytes BIGINT NULL,
  shot_at DATETIME NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  download_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_album_event_status_created (event_id, status, created_at),
  INDEX idx_album_uploader (uploader_user_id, uploader_openid),
  INDEX idx_album_file (file_id)
);

-- [Phase 3] Read-only verification
-- SHOW COLUMNS FROM event_album_photos;
-- SELECT id, event_id, file_id FROM event_album_photos ORDER BY id DESC LIMIT 5;

-- [Phase 4] Security rule (run via MCP writeSecurityRule)
-- resourceType: sqlDatabase
-- resourceId: event_album_photos
-- aclTag: ADMINWRITE

-- [Phase 5] Rollback (if absolutely needed)
-- DROP TABLE IF EXISTS event_album_photos;
