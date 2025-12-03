# S3 Web Admin (React + Bun)

A lightweight React UI for browsing and managing a single S3 bucket. Runs on Bun with Vite (`bun run start`).

## Features
- List objects by prefix with folder-style navigation
- Create folders, upload files or whole directories (preserves paths)
- Delete objects
- Copy links: public URL when ACL is public, signed URL when private
- User management UI with per-action permissions stored locally
- Pagination for large buckets (50 items per page)
- Auth-required APIs with simple JWT login (admin secret env) and protected `/admin` page

## Setup
1) Install dependencies
```bash
bun install
```
2) Copy env template and fill in your AWS details (server-side only)
```bash
cp .env.example .env
# then edit .env
```
Required env keys:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET`
- Auth: `ADMIN_SECRET` (shared secret to log in), `JWT_SECRET` (signing key)
- Optional: `AWS_SESSION_TOKEN`, `DEFAULT_OBJECT_ACL` (default `private`), `PUBLIC_BASE_URL`, `SIGNED_URL_TTL`

3) Build the client
```bash
bun run build
```

4) Start the server (serves dist/ and API on 5173)
```bash
bun run start
```

Dev mode (Vite on 5174, proxies /api to the server on 5173):
```bash
# Terminal 1
bun run server
# Terminal 2
bun run dev
```

## Docker
Build and run:
```bash
docker build -t s3webui .
docker run --rm -p 5173:5173 --env-file .env s3webui
```

Or with compose:
```bash
docker compose up --build
```

## Usage notes
- Default admin user has all permissions; add/manage more users in the UI. Choices persist in `localStorage`.
- If your default ACL includes `public-read`, "Copy link" uses the public URL. Otherwise it generates a signed URL.
- Signed link expiration is controlled by `VITE_SIGNED_URL_TTL` (seconds).
