#!/usr/bin/env bash
HOME=/app
cd /app
if [ ! -d "/app/ring-mqtt-${BRANCH}" ]; then
    echo "Updating ring-mqtt to the ${BRANCH} version..."
    if [ "${BRANCH}" = "latest" ]; then
        git clone https://github.com/tsightler/ring-mqtt ring-mqtt-latest
    else
        git clone -b dev https://github.com/tsightler/ring-mqtt ring-mqtt-dev
    fi
    cd "/app/ring-mqtt-${BRANCH}"
    echo "Installing node module dependencies, please wait..."
    npm install --no-progress > /dev/null 2>&1
    chmod +x ring-mqtt.js scripts/*.sh

    # This runs the downloaded version of this script in case there are
    # additonal component upgrade actions that need to be performed
    exec "/app/ring-mqtt-${BRANCH}/scripts/update2branch.sh"
    echo "-------------------------------------------------------"
else
    # Branch has already been initialized, run any post-update command here
    echo "The ring-mqtt-${BRANCH} branch has been updated."

    APK_ARCH="$(apk --print-arch)"
    case "${APK_ARCH}" in
        x86_64)
            HELPER_ARCH="amd64"
            ;;
        aarch64)
            HELPER_ARCH="arm64"
            ;;
        armv7|armhf)
            HELPER_ARCH="arm"
            ;;
        *)
            echo >&2 "ERROR: Unsupported architecture '$APK_ARCH'"
            exit 1
            ;;
    esac
    # The Go stream helper is compiled during the image build and the resulting
    # binary is not committed, so a freshly cloned branch has only the source.
    # Pre-built binaries for each supported architecture are committed under
    # ringstream/bin and one is installed here, which avoids needing a Go
    # toolchain in the container. They are refreshed with scripts/build-helper.sh.
    HELPER_DIR="/app/ring-mqtt-${BRANCH}/ringstream"
    HELPER_PREBUILT="${HELPER_DIR}/bin/ringstream_linux_${HELPER_ARCH}"
    if [ -f "${HELPER_PREBUILT}" ]; then
        cp -f "${HELPER_PREBUILT}" "${HELPER_DIR}/ringstream"
        chmod +x "${HELPER_DIR}/ringstream"
    elif [ -x "/app/ring-mqtt/ringstream/ringstream" ]; then
        echo "No pre-built stream helper for ${HELPER_ARCH} in the ${BRANCH} branch,"
        echo "falling back to the one that shipped in the image."
        cp -f "/app/ring-mqtt/ringstream/ringstream" "${HELPER_DIR}/ringstream"
        chmod +x "${HELPER_DIR}/ringstream"
    else
        echo >&2 "ERROR: no stream helper binary available, live streaming will not work"
    fi

    cp -f "/app/ring-mqtt-${BRANCH}/init/s6/services.d/ring-mqtt/run" /etc/services.d/ring-mqtt/run
    chmod +x /etc/services.d/ring-mqtt/run
fi
