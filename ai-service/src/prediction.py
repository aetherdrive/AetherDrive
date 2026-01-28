from __future__ import annotations

import json
from functools import lru_cache
from hashlib import sha256
from typing import Any, Dict

from flask import Flask, jsonify, request

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False


def _normalize_payload(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


@lru_cache(maxsize=256)
def _score_from_payload(payload_hash: str) -> Dict[str, Any]:
    value = int(payload_hash[:8], 16)
    risk_score = round((value % 100) / 100, 2)
    suggestion = "Ingen tiltak nødvendig" if risk_score < 0.4 else "Vurder oppfølging"
    return {"risk_score": risk_score, "suggestion": suggestion}


@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json(silent=True) or {}
    normalized = _normalize_payload(data)
    payload_hash = sha256(normalized.encode("utf-8")).hexdigest()
    scored = _score_from_payload(payload_hash)
    response = {**scored, "input_received": data}
    return jsonify(response)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, threaded=True)