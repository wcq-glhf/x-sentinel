#!/bin/bash
# OKX Copilot - Start Script

cd /home/ubuntu/.openclaw/workspace/okx-copilot

# Kill existing
pkill -f 'okx-copilot/backend/server.js' 2>/dev/null
pkill -f 'okx-copilot/frontend' 2>/dev/null
sleep 1

# Start backend
cd backend
nohup node server.js > /tmp/okx-backend.log 2>&1 &
echo "Backend PID: $!"

# Start frontend
cd ../frontend
nohup npm run dev -- --host > /tmp/okx-frontend.log 2>&1 &
echo "Frontend PID: $!"

echo "Done. Frontend: http://localhost:5174  Backend: http://localhost:3456"
