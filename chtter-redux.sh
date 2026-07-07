#!/bin/bash

# Start Chtter server and WhatsApp bridge
# Can be run from any directory

CHTTER_DIR="/home/lchinitz/Documents/Chtter-Redux/chtter-server"
WHATSAPP_DIR="/home/lchinitz/Documents/Chtter-Redux/whatsapp-mcp/whatsapp-bridge"

echo "Starting Chtter server..."
cd "$CHTTER_DIR" && node chtter-server.js &
CHTTER_PID=$!

echo "Starting WhatsApp bridge..."
cd "$WHATSAPP_DIR" && go run main.go &
WHATSAPP_PID=$!

echo "Both processes started. PIDs: Chtter=$CHTTER_PID, WhatsApp=$WHATSAPP_PID"
echo "Press Ctrl+C to stop both."

# Stop both processes cleanly on Ctrl+C
trap "echo 'Stopping...'; kill $CHTTER_PID $WHATSAPP_PID; exit 0" SIGINT SIGTERM

# Wait for both to finish
wait
