FROM hassioaddons/base
ENV LANG C.UTF-8
COPY . /ring-mqtt
RUN apk add --no-cache nodejs npm git && \
    rm -f /init && \
    mv /ring-mqtt/init / && \
    chmod +x /init/entrypoint.sh && \
    mkdir /data && \
    chmod 777 /data && \
    cd /ring-mqtt && \
    npm install
ENTRYPOINT [ "/init/entrypoint.sh" ]

