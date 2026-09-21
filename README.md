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
