#!/usr/bin/env bash
set -euo pipefail

cd /mnt/server

readonly repository="JSTR-Rat/pelican-wake-egg"
readonly archive="pelican-wake-proxy.tar.gz"
readonly checksum="pelican-wake-proxy.tar.gz.sha256"
readonly version="${APP_VERSION:-latest}"

if [[ "$version" == "latest" ]]; then
  readonly release_path="releases/latest/download"
elif [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  readonly release_path="releases/download/$version"
else
  printf 'Invalid APP_VERSION: %s\nExpected latest or vMAJOR.MINOR.PATCH.\n' "$version" >&2
  exit 1
fi

readonly base_url="https://github.com/$repository/$release_path"

printf 'Downloading Pelican wake proxy release %s...\n' "$version"
curl --fail --location --silent --show-error --retry 3 \
  "$base_url/$archive" --output "$archive"
curl --fail --location --silent --show-error --retry 3 \
  "$base_url/$checksum" --output "$checksum"

printf 'Verifying archive checksum...\n'
sha256sum -c "$checksum"

printf 'Installing application...\n'
tar -xzf "$archive"
test -f index.js
rm -f "$archive" "$checksum"

printf 'Pelican wake proxy installed as /mnt/server/index.js\n'
