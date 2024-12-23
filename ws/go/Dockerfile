# Use the official Go image
FROM golang:1.23

# Set the working directory inside the container
WORKDIR /app

# Copy go.mod and go.sum to manage dependencies
COPY go.mod go.sum ./

# Download dependencies (Go modules)
RUN go mod download

# Copy the entire application source code into the working directory
COPY . .

# Build the application executable
RUN go build -o websocket-server .

# Expose port 8080 for the WebSocket server
EXPOSE 8080

# Specify the command to run the WebSocket server
CMD ["./websocket-server"]