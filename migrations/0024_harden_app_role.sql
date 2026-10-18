-- Title: Harden the byos_app role
-- Description: Removes login (and its well-known password) from byos_app, which is only ever used through SET ROLE, and revokes its access to authentication tables.

-- 0009 created byos_app WITH LOGIN and a fixed password. The application never
-- logs in as this role; it connects as the owner and switches with SET ROLE.
-- A reachable database port therefore exposed a login whose password is in the
-- public repository and which can pick any tenant via app.current_user_id.
DO $$
BEGIN
    ALTER ROLE byos_app NOLOGIN PASSWORD NULL;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'Could not remove LOGIN from byos_app (insufficient privilege). Run as a superuser: ALTER ROLE byos_app NOLOGIN PASSWORD NULL;';
END $$;

-- Tenant-scoped queries never touch better-auth tables; foreign key checks run
-- as the table owner, so these grants are unnecessary.
REVOKE ALL ON TABLE public."user", public."session", public."account", public."verification" FROM byos_app;
