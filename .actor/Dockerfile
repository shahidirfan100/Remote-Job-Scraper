# Use official Apify base image with Node.js 22 for production compatibility
FROM apify/actor-node:22

# Copy package files
COPY package*.json ./

# Install dependencies (Apify base image handles this efficiently)
RUN npm install --only=production --no-audit

# Copy source code
COPY . ./

# Run the actor
CMD npm start
