# Base image
FROM node:20

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Build the app (ignore if not needed)
RUN npm run build || echo "No build step"

# Expose port (Render uses PORT env var, default 3000)
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
