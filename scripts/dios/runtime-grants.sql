-- psql variables: runtime_role (already created with LOGIN), tenant_id.
-- Executed by the migration operator; never create passwords in version control.
BEGIN;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"runtime_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
GRANT SELECT ON dios_schema_versions,dios_tenant_roles TO :"runtime_role";
GRANT SELECT,INSERT,UPDATE ON dios_records TO :"runtime_role";
GRANT SELECT,INSERT ON dios_revisions,dios_audit TO :"runtime_role";
GRANT SELECT ON dios_members TO :"runtime_role";
GRANT UPDATE(google_sub,auth_version) ON dios_members TO :"runtime_role";
GRANT SELECT,INSERT,UPDATE,DELETE ON dios_sessions,dios_oauth_states,dios_rate_limits TO :"runtime_role";
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";
INSERT INTO dios_tenant_roles(tenant_id,role_name) VALUES(:'tenant_id',:'runtime_role') ON CONFLICT DO NOTHING;
COMMIT;
