-- Waitlist feature migration
-- Adds registration_status tracking, waitlist positioning, and event-level waitlist toggle.
-- All existing rows default to confirmed; all events default to waitlist disabled.

-- Step 1: Add columns to event_participants
ALTER TABLE event_participants
  ADD COLUMN registration_status VARCHAR(32) NOT NULL DEFAULT 'confirmed' AFTER payment_status,
  ADD COLUMN waitlist_position INT NULL DEFAULT NULL AFTER registration_status,
  ADD COLUMN cancelled_at TIMESTAMP NULL DEFAULT NULL AFTER waitlist_position,
  ADD COLUMN promoted_at TIMESTAMP NULL DEFAULT NULL AFTER cancelled_at;

-- Step 2: Add index for efficient status queries
ALTER TABLE event_participants
  ADD INDEX idx_reg_status_event (event_id, registration_status, created_at);

-- Step 3: Add waitlist toggle to events table
ALTER TABLE events
  ADD COLUMN waitlist_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER max_participants;
