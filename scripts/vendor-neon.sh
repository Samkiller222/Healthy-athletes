#!/usr/bin/env bash
# Rebuild web/vendor/neon-js-<version>.js, a single-file browser bundle of the
# Neon SDK (@neon/neon-js: Neon Auth + Data API client). The site has no build
# step, so the bundle is committed. Run this to upgrade, then update the import
# in web/js/api.js.
set -euo pipefail
VERSION="${1:-0.10.2}"
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
(
  cd "$tmp"
  npm init -y >/dev/null
  npm install --silent "@neon/neon-js@$VERSION" esbuild@0.24.0
  echo 'export { createClient, BetterAuthVanillaAdapter } from "@neon/neon-js";' > entry.js
  npx esbuild entry.js --bundle --format=esm --minify --platform=browser --target=es2020 --outfile=bundle.js
)
cp "$tmp/bundle.js" "web/vendor/neon-js-$VERSION.js"
echo "wrote web/vendor/neon-js-$VERSION.js"
