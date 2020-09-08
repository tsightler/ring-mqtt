FROM node:12-alpine
ENV LANG=C.UTF-8 ISDOCKER=true
WORKDIR /ring-mqtt
COPY . .
RUN npm install && mkdir /data && chmod 777 /data
ENTRYPOINT ["node", "/ring-mqtt/ring-mqtt.js"]
