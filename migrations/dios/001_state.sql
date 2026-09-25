-- Run with a migration role, never the web application's login.
BEGIN;
CREATE TABLE IF NOT EXISTS dios_schema_versions(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS dios_tenant_roles(tenant_id text NOT NULL, role_name name NOT NULL, PRIMARY KEY(tenant_id,role_name));
CREATE TABLE IF NOT EXISTS dios_records(
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z0-9_-]{1,64}$'), bucket text NOT NULL,
  record_id text NOT NULL CHECK (length(record_id) BETWEEN 1 AND 256),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  version bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,bucket,record_id)
);
CREATE TABLE IF NOT EXISTS dios_revisions(
  revision_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id text NOT NULL, bucket text NOT NULL,
  record_id text NOT NULL, version bigint NOT NULL, document jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,bucket,record_id,version)
);
CREATE TABLE IF NOT EXISTS dios_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id text NOT NULL, entry jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS dios_members(
  tenant_id text NOT NULL, email text NOT NULL, google_sub text, principal jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true, auth_version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,email), UNIQUE(tenant_id,google_sub)
);
CREATE TABLE IF NOT EXISTS dios_sessions(
  tenant_id text NOT NULL, token_hash text NOT NULL, email text NOT NULL, google_sub text NOT NULL, auth_version integer NOT NULL,
  expires_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,token_hash), FOREIGN KEY(tenant_id,email) REFERENCES dios_members(tenant_id,email)
);
CREATE TABLE IF NOT EXISTS dios_oauth_states(tenant_id text NOT NULL, state_hash text NOT NULL, binding_hash text NOT NULL,nonce text NOT NULL, verifier text NOT NULL, expires_at timestamptz NOT NULL,PRIMARY KEY(tenant_id,state_hash));
CREATE TABLE IF NOT EXISTS dios_rate_limits(tenant_id text NOT NULL, rate_key text NOT NULL, window_start bigint NOT NULL,hits integer NOT NULL, PRIMARY KEY(tenant_id,rate_key));
CREATE OR REPLACE FUNCTION dios_reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DIOS_HISTORY_APPEND_ONLY'; END $$;
CREATE OR REPLACE FUNCTION dios_version_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.tenant_id <> NEW.tenant_id OR OLD.bucket <> NEW.bucket OR OLD.record_id <> NEW.record_id THEN RAISE EXCEPTION 'DIOS_RECORD_ID_IMMUTABLE'; END IF;
    NEW.version := OLD.version + 1;
  ELSE NEW.version := 1;
  END IF;
  NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION dios_archive_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO dios_revisions(tenant_id,bucket,record_id,version,document) VALUES(NEW.tenant_id,NEW.bucket,NEW.record_id,NEW.version,NEW.document);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS dios_records_version ON dios_records;
CREATE TRIGGER dios_records_version BEFORE INSERT OR UPDATE ON dios_records FOR EACH ROW EXECUTE FUNCTION dios_version_record();
DROP TRIGGER IF EXISTS dios_records_history ON dios_records;
CREATE TRIGGER dios_records_history AFTER INSERT OR UPDATE ON dios_records FOR EACH ROW EXECUTE FUNCTION dios_archive_record();
DROP TRIGGER IF EXISTS dios_records_no_delete ON dios_records;
CREATE TRIGGER dios_records_no_delete BEFORE DELETE ON dios_records FOR EACH ROW EXECUTE FUNCTION dios_reject_history_change();
DROP TRIGGER IF EXISTS dios_revisions_no_change ON dios_revisions;
CREATE TRIGGER dios_revisions_no_change BEFORE UPDATE OR DELETE ON dios_revisions FOR EACH ROW EXECUTE FUNCTION dios_reject_history_change();
DROP TRIGGER IF EXISTS dios_audit_no_change ON dios_audit;
CREATE TRIGGER dios_audit_no_change BEFORE UPDATE OR DELETE ON dios_audit FOR EACH ROW EXECUTE FUNCTION dios_reject_history_change();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dios_records','dios_revisions','dios_audit','dios_members','dios_sessions','dios_oauth_states','dios_rate_limits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS dios_tenant ON %I',t);
    EXECUTE format('CREATE POLICY dios_tenant ON %I USING (tenant_id = current_setting(''dios.tenant_id'',true) AND EXISTS(SELECT 1 FROM public.dios_tenant_roles r WHERE r.tenant_id=%I.tenant_id AND r.role_name=current_user)) WITH CHECK (tenant_id = current_setting(''dios.tenant_id'',true) AND EXISTS(SELECT 1 FROM public.dios_tenant_roles r WHERE r.tenant_id=%I.tenant_id AND r.role_name=current_user))',t,t,t);
  END LOOP;
END $$;
INSERT INTO dios_schema_versions(version) VALUES(1) ON CONFLICT DO NOTHING;
COMMIT;
