#!/usr/bin/env bash
# Build the Go stream helper for every architecture the add-on supports and
# stage the results in ringstream/bin.
#
# These binaries are committed so that update2branch.sh can install the helper
# without needing a Go toolchain in the container. Re-run this and commit the
# result whenever anything under ringstream/ changes, otherwise anyone tracking
# the dev or latest branch will get a stale helper.
set -e

cd "$(dirname "$0")/.."
SRC="ringstream"
OUT="${SRC}/bin"

if ! command -v go > /dev/null 2>&1; then
    echo >&2 "ERROR: no Go toolchain found"
    exit 1
fi

mkdir -p "${OUT}"

# One arm build, compiled for ARMv6 so that it runs on both armhf and armv7,
# which is what update2branch.sh selects between.
build() {
    local arch="$1" goarm="$2" name="$3"
    echo "Building ${name}..."
    ( cd "${SRC}" && CGO_ENABLED=0 GOOS=linux GOARCH="${arch}" GOARM="${goarm}" \
        go build -trimpath -ldflags "-s -w" -o "bin/${name}" . )
}

build amd64 "" ringstream_linux_amd64
build arm64 "" ringstream_linux_arm64
build arm   6  ringstream_linux_arm

chmod +x "${OUT}"/ringstream_linux_*
echo
ls -l "${OUT}"
