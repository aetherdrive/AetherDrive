from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/predict', methods=['POST'])
def predict():
    data = request.json
    return jsonify({
        "risk_score": 0.1,
        "suggestion": "Ingen tiltak nødvendig",
        "input_received": data
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
