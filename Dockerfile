ARG BUILD_FROM
FROM $BUILD_FROM

ENV LANG C.UTF-8
ENV DEBUG *

RUN apk add --no-cache nodejs npm jq
COPY package.json .
RUN npm install 

# Copy data for add-on
COPY . .
RUN ls -l
RUN chmod a+x /ring-alarm-mqtt.js

CMD [ "/ring-alarm-mqtt.js" ]
