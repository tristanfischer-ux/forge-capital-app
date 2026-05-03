-- investors_mirror contains public website data intended for all visitors.
-- The /discover page runs server-side with the anon key, so an anon
-- SELECT policy is required for any rows to be visible.

CREATE POLICY "investors_mirror_anon_select"
ON public.investors_mirror
FOR SELECT
TO anon
USING (true);
