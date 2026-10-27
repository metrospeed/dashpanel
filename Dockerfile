FROM node:24-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY mcp ./mcp
COPY config/dashboard.example.json ./config/
ENV PORT=7676
EXPOSE 7676
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:7676/api/config >/dev/null || exit 1
CMD ["node", "server.js"]
