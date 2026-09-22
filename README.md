# Pelican Wake Proxy

The application reads all configuration from `process.env`. It does not load
environment files itself, and it does not depend on dotenv or dotenvx.

## Configuration Examples

Copy an example to any local filename and fill in the required values:

```sh
cp .env.vanilla.example .env.vanilla
```

or:

```sh
cp .env.create.example .env.create
```

The filenames are examples only. The operator chooses the filename and the
configuration; the application does not inspect or interpret the filename.

## Optional Local dotenvx Loading

`dotenvx` is optional and is intended only as a convenient way to run or debug
the egg locally. It is not required when the egg runs in Pelican, and it is not
required for local development either. Pelican supplies the process environment
directly; the production egg does not need dotenvx installed.

Developers who do not want to use dotenvx can export the required variables in
their shell before running `pnpm dev`:

```sh
export PELICAN_BASE_URL=https://pelican.example.com
export PELICAN_API_KEY=replace-me
export PELICAN_SERVER_ID=replace-me
export MINECRAFT_VERSION_NAME=26.3
export MINECRAFT_PROTOCOL_VERSION=777
export BACKEND_HOST=minecraft.example.internal
export MANAGEMENT_HOST=minecraft.example.internal
export MANAGEMENT_PORT=25585
export MANAGEMENT_SECRET=replace-me
pnpm dev
```

Install dotenvx globally, outside this project:

```sh
pnpm add --global @dotenvx/dotenvx
```

Use the global CLI to load a selected file before starting the generic project
command:

```sh
dotenvx run -f .env.vanilla -- pnpm dev
dotenvx run -f .env.create -- pnpm dev
```

Any path works equally well:

```sh
dotenvx run -f ~/minecraft/proxy-prod.env -- pnpm dev
```

dotenvx sets `process.env`; the application then validates those values using
its normal configuration rules. Ordinary shell-provided variables work too:

```sh
PELICAN_BASE_URL=https://pelican.example.com \
PELICAN_API_KEY=replace-me \
PELICAN_SERVER_ID=replace-me \
MINECRAFT_VERSION_NAME=26.3 \
MINECRAFT_PROTOCOL_VERSION=777 \
PLAYER_PROVIDER=management \
MANAGEMENT_HOST=minecraft.example.internal \
MANAGEMENT_PORT=25585 \
MANAGEMENT_SECRET=replace-me \
pnpm dev
```

Run checks with:

```sh
pnpm typecheck
pnpm test
```

## Backend Timeouts

All timeout values are milliseconds. `BACKEND_CONNECT_TIMEOUT_MS` (default
`3000`) is only the maximum time to establish a backend TCP connection.
`BACKEND_STATUS_TIMEOUT_MS` (default `5000`) is the maximum time for a complete
Minecraft status query after connecting. `BACKEND_START_TIMEOUT_MS` (default
`300000`) is the maximum time for Minecraft to become ready after Pelican
accepts a start request. Forwarded player connections have no application-level
idle timeout.

`BACKEND_HOST` is required and has no built-in default; `BACKEND_PORT` is
optional and defaults to `25566`.

## Release and Pelican Installation

Build the production bundle locally with:

```sh
pnpm build
```

Create and push a semantic version tag to publish a release:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The tag-based GitHub Actions workflow publishes these stable-named assets:

```text
pelican-wake-proxy.tar.gz
pelican-wake-proxy.tar.gz.sha256
```

The `pelican/install.sh` file is source material for the custom Pelican egg.
It downloads and verifies the selected public GitHub Release artifact instead
of cloning the repository or compiling it. Set `APP_VERSION` to `latest` or a
specific tag such as `v0.1.0`; `latest` is convenient, while a pinned tag is
more reproducible.

The archive contains only `index.js`, so the eventual Node 24 Pelican Yolk
(`ghcr.io/pelican-eggs/yolks:nodejs_24`) can start it with:

```sh
PROXY_HOST=0.0.0.0 PROXY_PORT={{SERVER_PORT}} node index.js
```

No `node_modules`, pnpm, TypeScript compiler, repository checkout, or dotenvx
is required at runtime. Pelican variables are read directly from
`process.env`.
