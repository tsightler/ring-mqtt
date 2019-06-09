FROM node:8

WORKDIR /srv

COPY package*.json ./

RUN npm install

COPY . .

CMD ["npm", "start"]