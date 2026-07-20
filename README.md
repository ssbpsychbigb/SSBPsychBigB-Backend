# SSBPsychBigB Backend

Node.js + Express + MongoDB API scaffolded for a large, long-lived client project.

## Architecture

Layered **feature modules** with one-way dependency flow:

```
Route → Controller → Service → (Repository) → Model / MongoDB
```

```
src/
├── server.js                 # Bootstrap: DB + listen + graceful shutdown
├── app.js                    # Express app factory (testable, no listen)
├── config/                   # Env validation + Mongo connection
├── common/                   # Shared errors, middleware, utils, constants
├── modules/                  # Domain features (add one folder per feature)
│   └── health/
└── routes/                   # Versioned API mount (/api/v1)
```

### Adding a new feature

1. Create `src/modules/<feature>/` with:
   - `<feature>.model.js`
   - `<feature>.service.js`
   - `<feature>.controller.js`
   - `<feature>.routes.js`
2. Export the router from `src/modules/index.js`
3. Mount it in `src/routes/index.js` under `/api/v1`

## Setup

1. Copy env file and set values:

```bash
cp .env.example .env
```

2. Ensure MongoDB is running and `MONGODB_URI` is correct.

3. Install dependencies:

```bash
yarn install
```

4. Run:

```bash
yarn dev    # development (nodemon)
yarn start  # production
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | API identity |
| GET | `/api/v1/health` | Health + DB readiness |

## Environment

| Variable | Purpose | Example |
|----------|---------|---------|
| `NODE_ENV` | Runtime mode | `development` |
| `PORT` | HTTP port | `5000` |
| `API_PREFIX` | API base path | `/api/v1` |
| `MONGODB_URI` | Mongo connection string | `mongodb://127.0.0.1:27017/ssbpsychbigb` |
| `CORS_ORIGIN` | Allowed frontend origins (comma-separated) | `http://localhost:5173` |

Replace placeholders in `.env` before deploying. Never commit real secrets.
