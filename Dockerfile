FROM node:18-bullseye-slim

# Install dependencies required for bot (Python for yt-dlp, FFmpeg for music)
RUN apt-get update && \
    apt-get install -y python3 ffmpeg build-essential && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Expose the port (Render will use PORT env var, but good to document)
EXPOSE 8080

# Start the bot
CMD ["node", "index.js"]
