-- Title: Per-recipe data refresh intervals
-- Description: Allows each user to set a recipe's data refresh interval independently of device wakeups.
ALTER TABLE public.screen_configs
  ADD COLUMN IF NOT EXISTS data_refresh_seconds INTEGER
  CHECK (data_refresh_seconds BETWEEN 0 AND 86400);
