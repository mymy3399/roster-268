# Repository Guidelines

## Project Structure & Module Organization

This is a small Node.js/Express directory application with a SQLite data store and a single-page frontend.

- `server.js` contains the HTTP API, authentication, database setup, and static-file serving.
- `index.html` contains the client UI, styles, and browser-side JavaScript.
- `public/` holds PWA files, icons, and profile photos; `public/sw.js` is the service worker.
- `data/people.json` seeds the database, while `data/database.sqlite*` contains runtime state.
- `scripts/enhance_photos.py` is an optional Pillow-based image utility.
- `Dockerfile` and `docker-compose.yml` define the production-style container setup.

Do not edit generated SQLite WAL files, dependencies under `node_modules/`, or `index.html.bak`.

## Build, Test, and Development Commands

- `npm ci` installs the exact dependencies recorded in `package-lock.json`.
- `npm start` runs the server at `http://localhost:3000` (or `$PORT`).
- `docker compose up --build` builds and starts the container with persistent data/photo mounts.
- `docker compose down` stops the container; `docker compose logs -f` follows its logs.
- `python3 scripts/enhance_photos.py` upscales undersized JPG portraits in place; install Pillow first and back up images.

There is currently no automated build step or functional `npm test` suite.

## Coding Style & Naming Conventions

Follow the existing style: two-space indentation, semicolons, single quotes, and CommonJS `require()` in JavaScript. Use `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants, and descriptive REST paths under `/api/`. Python follows four-space indentation, `snake_case`, type hints, and `pathlib`. Keep frontend changes localized and preserve the existing Thai-language content.

## Testing Guidelines

For server changes, start the app and smoke-test affected endpoints, for example:

```bash
curl http://localhost:3000/api/people
```

Also verify the UI in a browser, including offline/PWA behavior when changing cached assets. New automated tests should live in `test/` and use names such as `server.test.js`; wire them into `npm test`.

## Commit & Pull Request Guidelines

No project commit history is available, so use concise imperative subjects (for example, `Validate profile edit payload`). Keep commits focused. Pull requests should explain behavior changes, testing performed, database or configuration impacts, and linked issues. Include screenshots for visible UI changes.

## Security & Data Handling

Set `ADMIN_PIN` through the environment outside local development; do not commit real credentials. Treat profile data and photos as sensitive. Avoid committing runtime database changes or exposing backups in static routes.
