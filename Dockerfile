FROM node:12-alpine
ENV LANG=C.UTF-8 ISDOCKER=true
WORKDIR /ring-mqtt
COPY . .
RUN npm install
ENTRYPOINT ["node", "/ring-mqtt/ring-mqtt.js"]
