FROM node:22-alpine AS dependencies

WORKDIR /usr/src/app

RUN apk add --no-cache python3 make g++

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY --from=dependencies /usr/src/app/node_modules ./node_modules
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
