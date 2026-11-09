
-- Revoke anon access if it exists (as a backup security measure)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Grant minimal anon access if needed? But app doesn't use direct Supabase anon auth
-- The backend uses service role via pooler - so anon needs nothing
GRANT USAGE ON SCHEMA public TO anon;
-- Do NOT grant table privileges to anon

-- Also secure authenticated role
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
-- authenticated gets access only via RLS policies if needed
