from __future__ import annotations

import json
from functools import lru_cache
from hashlib import sha256
from typing import Any, Dict

from flask import Flask, jsonify, request

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False

def _normalize_payload(payload: Dict[str, Any]) -> str:
    """
    Normalize the input payload to a deterministic JSON string. This ensures
    that hashing yields consistent results even if key ordering differs.
    """
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

@lru_cache(maxsize=256)
def _score_from_payload(payload_hash: str) -> Dict[str, Any]:
    """
    Derive a pseudo risk score from the first 8 characters of a SHA256 hash.
    This function is cached to speed up repeated lookups.
    """
    value = int(payload_hash[:8], 16)
    risk_score = round((value % 100) / 100, 2)
    suggestion = "Ingen tiltak nødvendig" if risk_score < 0.4 else "Vurder oppfølging"
    return {"risk_score": risk_score, "suggestion": suggestion}

@app.route("/predict", methods=["POST"])
def predict():
    """
    Dummy prediction endpoint.
    Accepts a JSON payload, normalizes it, hashes the payload and returns a
    deterministic risk score and suggestion. The original input is returned
    alongside the risk assessment for transparency.
    """
    data = request.get_json(silent=True) or {}
    normalized = _normalize_payload(data)
    payload_hash = sha256(normalized.encode("utf-8")).hexdigest()
    scored = _score_from_payload(payload_hash)
    response = {**scored, "input_received": data}
    return jsonify(response)

if __name__ == "__main__":
    # Only run the development server if this file is executed directly.
    app.run(host="0.0.0.0", port=5000, threaded=True)