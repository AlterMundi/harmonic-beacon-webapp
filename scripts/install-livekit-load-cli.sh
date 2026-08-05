#!/usr/bin/env bash
set -euo pipefail

readonly SOURCE_REPOSITORY='https://github.com/livekit/livekit-cli.git'
readonly SOURCE_COMMIT='e90c82ab4467cafd4fabe3affd348f474c312280'
readonly EXPECTED_VERSION='lk version 2.16.3-hb-vp8.1'
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PATCH_FILE="$SCRIPT_DIR/patches/livekit-cli-v2.16.3-vp8-depacketizer.patch"

if [[ $# -ne 1 || -z "$1" ]]; then
    echo 'usage: scripts/install-livekit-load-cli.sh OUTPUT_PATH' >&2
    exit 2
fi

readonly OUTPUT_PATH="$(realpath -m -- "$1")"
readonly BUILD_ROOT="$(mktemp -d)"
readonly SOURCE_ROOT="$BUILD_ROOT/livekit-cli"

cleanup() {
    rm -rf -- "$BUILD_ROOT"
}
trap cleanup EXIT

command -v git >/dev/null
command -v go >/dev/null
command -v git-lfs >/dev/null

GIT_LFS_SKIP_SMUDGE=1 git clone --quiet --no-checkout --filter=blob:none \
    "$SOURCE_REPOSITORY" "$SOURCE_ROOT"
git -C "$SOURCE_ROOT" fetch --quiet --depth=1 origin "$SOURCE_COMMIT"
git -C "$SOURCE_ROOT" checkout --quiet --detach FETCH_HEAD
test "$(git -C "$SOURCE_ROOT" rev-parse HEAD)" = "$SOURCE_COMMIT"

git -C "$SOURCE_ROOT" lfs pull --include='pkg/provider/resources/**'
git -C "$SOURCE_ROOT" lfs fsck
git -C "$SOURCE_ROOT" apply --check "$PATCH_FILE"
git -C "$SOURCE_ROOT" apply "$PATCH_FILE"

mkdir -p -- "$(dirname -- "$OUTPUT_PATH")"
(
    cd "$SOURCE_ROOT"
    go build -trimpath -ldflags='-s -w' -o "$OUTPUT_PATH" ./cmd/lk
)
test "$($OUTPUT_PATH --version)" = "$EXPECTED_VERSION"
sha256sum "$OUTPUT_PATH"
