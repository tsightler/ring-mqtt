FROM node:12-alpine

WORKDIR /srv

COPY package*.json ./

RUN npm install

COPY . .

CMD ["npm", "start"]