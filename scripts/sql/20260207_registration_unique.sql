-- Add unique constraint to prevent duplicate registrations (race condition fix)
-- This ensures that a user can only register once per event at the database level.
-- The BFF registration endpoint should catch duplicate key errors and return ALREADY_SIGNED.

-- Step 1: Check for existing duplicates before adding the constraint
-- SELECT event_id, user_openid, COUNT(*) as cnt
-- FROM event_participants
-- GROUP BY event_id, user_openid
-- HAVING cnt > 1;
-- If duplicates exist, resolve them manually before running the ALTER.

-- Step 2: Add the unique constraint
ALTER TABLE event_participants
  ADD UNIQUE KEY uk_event_user_openid (event_id, user_openid);
