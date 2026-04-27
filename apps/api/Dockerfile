FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY src/ ./src/

RUN mkdir -p data/uploads

EXPOSE 4000

CMD ["node", "src/server.js"]
