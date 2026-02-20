BEGIN;

-- Midlertidig: slå av RLS kun for bootstrap på disse tabellene
ALTER TABLE aetherdrive.organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.api_keys       DISABLE ROW LEVEL SECURITY;

-- 1) Opprett org (tenant)
INSERT INTO aetherdrive.organizations (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Demo Org')
ON CONFLICT (id) DO NOTHING;

-- 2) Opprett API key (lagre hash, aldri plaintext)
INSERT INTO aetherdrive.api_keys (org_id, key_hash, label, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '<PUT_SHA256_HEX_HERE>',
  'demo-key',
  true
)
ON CONFLICT (key_hash) DO NOTHING;

-- Slå på RLS igjen
ALTER TABLE aetherdrive.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.api_keys       ENABLE ROW LEVEL SECURITY;

COMMIT;
