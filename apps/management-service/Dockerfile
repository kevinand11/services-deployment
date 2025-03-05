ARG NODE_VERSION=node:20.15.0-alpine3.20

FROM $NODE_VERSION AS deploy

WORKDIR /app

COPY ./package.json ./

RUN npm i --omit=dev

COPY ./ ./

ENV PORT=3000

ENTRYPOINT ["node","index.js"]