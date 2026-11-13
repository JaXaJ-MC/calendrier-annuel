FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY calendrier.js serveur.js config.json ./
COPY polices ./polices
ENV HOST=0.0.0.0 PORT=8642
EXPOSE 8642
USER node
CMD ["node", "serveur.js"]
