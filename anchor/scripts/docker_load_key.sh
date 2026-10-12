#!/usr/bin/env bash
# Copy a keeper keypair into the `keeper-secrets` Docker volume (read by the keeper container).
# Uses stdin instead of a bind mount, so Docker Desktop needs no access to your project folder
# and the key never becomes part of an image or build context.
#
#   ./scripts/docker_load_key.sh [path/to/keeper-keypair.json]
set -euo pipefail
KEY=${1:-keeper/devnet-keeper-keypair.json}
[ -f "$KEY" ] || { echo "no keypair at $KEY"; exit 1; }
docker volume create keeper-secrets >/dev/null
docker run --rm -i -v keeper-secrets:/secrets --entrypoint sh debian:bookworm-slim -c \
  'cat > /secrets/keeper.json && chown 10001 /secrets/keeper.json && chmod 400 /secrets/keeper.json' < "$KEY"
echo "loaded $(solana address -k "$KEY" 2>/dev/null || echo "$KEY") into volume keeper-secrets"
