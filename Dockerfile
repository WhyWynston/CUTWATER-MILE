FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
COPY public ./public
# Attendance records and photos. Mount a persistent volume here.
ENV DATA_DIR=/data
# Hosting platforms sit behind a proxy; this keeps login cookies marked Secure.
ENV TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "server.js"]
