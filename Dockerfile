FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Cloud Run defaults to port 8080
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
