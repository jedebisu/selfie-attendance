-- Fix RLS and security policies for Selfie-Attendance (nzbvfgbnyidaptqmabbn)
-- This migration secures tables while preserving backend API functionality

-- Enable RLS on tables that don't have it
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE naps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
-- work_order_requests and selfie-attendance-db already have RLS enabled

-- Drop any existing policies if they exist
DROP POLICY IF EXISTS "no_anonymous_access" ON users;
DROP POLICY IF EXISTS "service_role_full_access_users" ON users;
DROP POLICY IF EXISTS "authenticated_users_own_read" ON users;
DROP POLICY IF EXISTS "no_anonymous_access_att" ON attendance;
DROP POLICY IF EXISTS "service_role_full_access_attendance" ON attendance;
DROP POLICY IF EXISTS "no_anonymous_access_lr" ON leave_requests;
DROP POLICY IF EXISTS "no_anonymous_access_lp" ON location_pings;
DROP POLICY IF EXISTS "no_anonymous_access_naps" ON naps;
DROP POLICY IF EXISTS "public_read_naps" ON naps;
DROP POLICY IF EXISTS "service_role_full_access_naps" ON naps;
DROP POLICY IF EXISTS "no_anonymous_access_sessions" ON sessions;
DROP POLICY IF EXISTS "service_role_full_access_sessions" ON sessions;
DROP POLICY IF EXISTS "no_anonymous_access_sadb" ON "selfie-attendance-db";
DROP POLICY IF EXISTS "no_anonymous_access_wor" ON work_order_requests;

-- Service role (backend) needs full access - Supabase service role bypasses RLS
-- Create permissive policies for service role operations
CREATE POLICY "service_role_full_access_users" ON users
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_attendance" ON attendance
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_leave_requests" ON leave_requests
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_location_pings" ON location_pings
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_naps" ON naps
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_sessions" ON sessions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_sadb" ON "selfie-attendance-db"
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role_full_access_wor" ON work_order_requests
  FOR ALL USING (auth.role() = 'service_role');

-- Deny anonymous access (anon role) - they must go through backend API
CREATE POLICY "deny_anonymous_users" ON users
  FOR ALL USING (auth.role() != 'anon');

CREATE POLICY "deny_anonymous_attendance" ON attendance
  FOR ALL USING (auth.role() != 'anon');

CREATE POLICY "deny_anonymous_leave_requests" ON leave_requests
  FOR ALL USING (auth.role() != 'anon');

CREATE POLICY "deny_anonymous_location_pings" ON location_pings
  FOR ALL USING (auth.role() != 'anon');

CREATE POLICY "deny_anonymous_naps" ON naps
  FOR ALL USING (auth.role() != 'anon');

CREATE POLICY "deny_anonymous_sessions" ON sessions
  FOR ALL USING (auth.role() != 'anon');

CREATE POLICY "deny_anonymous_sadb" ON "selfie-attendance-db"
  FOR ALL USING (auth.role() != 'anon');

CREATE POLICY "deny_anonymous_wor" ON work_order_requests
  FOR ALL USING (auth.role() != 'anon');

-- For authenticated users (if ever used directly), be restrictive
-- But app primarily uses backend with service role
CREATE POLICY "authenticated_read_own_users" ON users
  FOR SELECT USING (auth.role() = 'authenticated' AND auth.uid()::text = id::text);

CREATE POLICY "authenticated_read_own_attendance" ON attendance
  FOR SELECT USING (auth.role() = 'authenticated' AND auth.uid()::text = user_id::text);

