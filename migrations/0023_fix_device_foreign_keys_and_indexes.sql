-- Title: Fix device foreign keys and add hot-path indexes
-- Description: Lets devices, playlists and mixups be deleted or renamed while referenced (logs cascade, device assignments clear), and indexes device logs and playlist items.

-- Drop every foreign key on <table>.<column>, whatever it was named when created.
CREATE OR REPLACE FUNCTION pg_temp.byos_drop_column_fks(target regclass, column_name text)
RETURNS void AS $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = target
          AND c.contype = 'f'
          AND a.attname = column_name
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', target, constraint_name);
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Device logs follow their device: renaming the friendly id keeps them attached,
-- deleting the device (directly or via its owner) removes them. Previously both
-- operations failed as soon as a device had sent a single log.
SELECT pg_temp.byos_drop_column_fks('public.logs', 'friendly_id');
ALTER TABLE public.logs
    ADD CONSTRAINT logs_friendly_id_fkey FOREIGN KEY (friendly_id)
    REFERENCES public.devices (friendly_id) ON UPDATE CASCADE ON DELETE CASCADE;

-- Deleting a playlist or mixup that a device uses clears the assignment instead
-- of failing with a foreign key violation.
SELECT pg_temp.byos_drop_column_fks('public.devices', 'playlist_id');
ALTER TABLE public.devices
    ADD CONSTRAINT devices_playlist_id_fkey FOREIGN KEY (playlist_id)
    REFERENCES public.playlists (id) ON DELETE SET NULL;

SELECT pg_temp.byos_drop_column_fks('public.devices', 'mixup_id');
ALTER TABLE public.devices
    ADD CONSTRAINT devices_mixup_id_fkey FOREIGN KEY (mixup_id)
    REFERENCES public.mixups (id) ON DELETE SET NULL;

-- Device log pages filter by device and sort newest first; retention deletes by age.
CREATE INDEX IF NOT EXISTS idx_logs_friendly_id_created_at
    ON public.logs (friendly_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.logs (created_at);

-- Read on every playlist-mode display request.
CREATE INDEX IF NOT EXISTS idx_playlist_items_playlist_order
    ON public.playlist_items (playlist_id, order_index);

-- Support ON DELETE SET NULL without scanning devices.
CREATE INDEX IF NOT EXISTS idx_devices_playlist_id ON public.devices (playlist_id);
CREATE INDEX IF NOT EXISTS idx_devices_mixup_id ON public.devices (mixup_id);
