#!/usr/bin/env bash
set -euo pipefail

: "${PB_URL:?Set PB_URL (e.g. https://your-render-url)}"
: "${PB_KEY:?Set PB_KEY (Render INTEGRATION_KEY value)}"
PB_ROLE="${PB_ROLE:-employer_admin}"

echo "== PayBridge v2: FjordAuto AS test =="

echo "[1] Create run..."
RUN_JSON=$(curl -s -X POST "$PB_URL/api/payroll-runs" \
  -H "Content-Type: application/json" \
  -H "X-PAYBRIDGE-KEY: $PB_KEY" \
  -H "X-User-Role: $PB_ROLE" \
  -H "X-Idempotency-Key: fjordauto-run-2026-01" \
  -d '{
    "company_id": 1,
    "period_start": "2026-01-01",
    "period_end": "2026-01-31",
    "pay_date": "2026-02-05",
    "currency": "NOK",
    "rule_set_version": "v1"
  }')

echo "$RUN_JSON"
RUN_ID=$(echo "$RUN_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const j=JSON.parse(s);console.log((j.run&&j.run.id)||j.id||'');});")
if [[ -z "$RUN_ID" ]]; then
  echo "Could not parse RUN_ID. Install jq or inspect output."
  exit 1
fi
echo "RUN_ID=$RUN_ID"

echo "[2] Import inputs..."
curl -s -X POST "$PB_URL/api/payroll-runs/$RUN_ID/import" \
  -H "Content-Type: application/json" \
  -H "X-PAYBRIDGE-KEY: $PB_KEY" \
  -H "X-User-Role: $PB_ROLE" \
  -H "X-Idempotency-Key: fjordauto-import-2026-01" \
  -d '{
    "items": [
      { "employee": "A1", "line_type": "salary", "amount": 52000 },
      { "employee": "A1", "line_type": "withholding", "amount": 16000 },

      { "employee": "A2", "line_type": "salary", "amount": 45000 },
      { "employee": "A2", "line_type": "withholding", "amount": 13500 },

      { "employee": "A3", "line_type": "salary", "amount": 42000 },
      { "employee": "A3", "line_type": "withholding", "amount": 12500 },

      { "employee": "A4", "line_type": "salary", "amount": 40000 },
      { "employee": "A4", "line_type": "withholding", "amount": 12000 },

      { "employee": "A5", "line_type": "salary", "amount": 28000 },
      { "employee": "A5", "line_type": "withholding", "amount": 6000 }
    ]
  }' | cat

echo
echo "[3] Calculate..."
curl -s -X POST "$PB_URL/api/payroll-runs/$RUN_ID/calculate" \
  -H "X-PAYBRIDGE-KEY: $PB_KEY" \
  -H "X-User-Role: $PB_ROLE" | cat

echo
echo "[4] Approve..."
curl -s -X POST "$PB_URL/api/payroll-runs/$RUN_ID/approve" \
  -H "X-PAYBRIDGE-KEY: $PB_KEY" \
  -H "X-User-Role: $PB_ROLE" | cat

echo
echo "[5] Commit..."
curl -s -X POST "$PB_URL/api/payroll-runs/$RUN_ID/commit" \
  -H "X-PAYBRIDGE-KEY: $PB_KEY" \
  -H "X-User-Role: $PB_ROLE" | cat

echo
echo "[6] Reconciliation..."
curl -s "$PB_URL/api/payroll-runs/$RUN_ID/reconciliation" \
  -H "X-PAYBRIDGE-KEY: $PB_KEY" \
  -H "X-User-Role: $PB_ROLE" | cat

echo
echo "== Done =="
