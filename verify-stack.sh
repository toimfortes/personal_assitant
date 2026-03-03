#!/bin/bash

echo "🔍 Verifying Email Master Stack..."

# 1. Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running."
    exit 1
fi

# 2. Check if containers are up
containers=("email-master-n8n" "email-master-openclaw")
for container in "${containers[@]}"; do
    if [ "$(docker inspect -f '{{.State.Running}}' $container 2>/dev/null)" == "true" ]; then
        echo "✅ $container is running."
    else
        echo "❌ $container is NOT running."
    fi
done

# 3. Test Internal Networking (n8n -> OpenClaw)
echo "📡 Testing internal connection between n8n and OpenClaw..."
docker exec email-master-n8n curl -s -I http://openclaw:18789 > /dev/null
if [ $? -eq 0 ]; then
    echo "✅ n8n can reach OpenClaw on the private network."
else
    echo "❌ n8n cannot reach OpenClaw internally."
fi

# 4. Check Filesystem Isolation
echo "🛡 Checking filesystem isolation..."
AGENT_HOME=$(docker exec email-master-openclaw pwd)
if [[ "$AGENT_HOME" == "/home/node" ]]; then
    echo "✅ Agent is running in a standard home directory."
else
    echo "⚠️ Agent home is unexpected: $AGENT_HOME"
fi

echo "✨ Verification complete."
