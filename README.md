# AetherDrive

Denne repoen inneholder tre hovedmapper plassert i repo-roten:

- `ai-service` – AI/service-relatert kode
- `backend` – Node.js backend og databaseoppsett
- `frontend` – frontend-ressurser

Tidligere var koden pakket under en ytre mappe som ble ryddet. Hvis du trenger den opprinnelige `README.mdown`, gi beskjed så kan jeg forsøke å hente den fra git-historikken.

Vanlige kommandoer:

```
# Sjekk node-versjon
node -v

# Kjør backend (fra backend-mappen)
cd backend && npm install && npm start

# Kjør AI-service (fra ai-service-mappen)
cd ai-service && pip install -r requirements.txt && python src/prediction.py
```

