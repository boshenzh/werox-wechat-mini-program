-- WeRox identity unification migration
-- Goal: introduce user_id as business key, keep openid as channel identity

CREATE TABLE IF NOT EXISTS app_users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  _openid VARCHAR(64) DEFAULT '' NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'runner',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app_users_role (role),
  INDEX idx_app_users_status (status)
);

CREATE TABLE IF NOT EXISTS identity_links (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  _openid VARCHAR(64) DEFAULT '' NOT NULL,
  user_id BIGINT NOT NULL,
  provider VARCHAR(64) NOT NULL,
  provider_uid VARCHAR(128) NOT NULL,
  unionid VARCHAR(128) NULL,
  appid VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP NULL,
  UNIQUE KEY uk_provider_uid (provider, provider_uid),
  INDEX idx_unionid (unionid),
  INDEX idx_user_id (user_id)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS user_id BIGINT NULL,
  ADD UNIQUE KEY uk_users_user_id (user_id),
  ADD INDEX idx_users_openid (openid);

ALTER TABLE event_participants
  ADD COLUMN IF NOT EXISTS user_id BIGINT NULL,
  ADD INDEX idx_participants_user_id (user_id),
  ADD INDEX idx_participants_event_user (event_id, user_id);

-- Seed app_users + identity_links from existing users table (wechat_mini)
INSERT INTO app_users (_openid, role, status)
SELECT u.openid, COALESCE(u.role, 'runner'), 'active'
FROM users u
LEFT JOIN app_users a ON a.id = u.user_id
WHERE u.openid IS NOT NULL
  AND u.openid <> ''
  AND a.id IS NULL;

-- Bind users.user_id by openid (best-effort based on creation order)
UPDATE users u
JOIN (
  SELECT id, _openid
  FROM app_users
) a ON a._openid = u.openid
SET u.user_id = a.id
WHERE u.user_id IS NULL;

-- Insert identity links for mini program identities
INSERT INTO identity_links (_openid, user_id, provider, provider_uid, unionid, appid)
SELECT u.openid, u.user_id, 'wechat_mini', u.openid, NULL, NULL
FROM users u
LEFT JOIN identity_links l
  ON l.provider = 'wechat_mini' AND l.provider_uid = u.openid
WHERE u.user_id IS NOT NULL
  AND u.openid IS NOT NULL
  AND u.openid <> ''
  AND l.id IS NULL;

-- Backfill registration user_id using legacy openid mapping
UPDATE event_participants ep
JOIN users u ON u.openid = ep.user_openid
SET ep.user_id = u.user_id
WHERE ep.user_id IS NULL
  AND ep.user_openid IS NOT NULL
  AND ep.user_openid <> '';
