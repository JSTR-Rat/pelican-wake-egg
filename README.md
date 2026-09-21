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

## External dotenvx Loading

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
MANAGEMENT_HOST=192.168.1.100 \
MANAGEMENT_PORT=25585 \
MANAGEMENT_SECRET=replace-me \
pnpm dev
```

Run checks with:

```sh
pnpm typecheck
pnpm test
```

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
