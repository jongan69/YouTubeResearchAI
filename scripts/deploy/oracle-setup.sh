#!/bin/bash
# YTResearchAI — Oracle Cloud Always Free ARM VM Setup
# Run once on a fresh Ubuntu 24.04 ARM instance.
# Tested on: Oracle Ampere A1 (2 OCPU, 12 GB RAM, 200 GB disk)

set -e

echo "=== YTResearchAI Server Setup ==="

# ---- System dependencies ----
echo "Installing system packages..."
sudo apt update -qq
sudo apt install -y -qq python3 python3-pip ffmpeg nodejs npm caddy curl ufw

# ---- yt-dlp ----
echo "Installing yt-dlp..."
python3 -m pip install -q yt-dlp

# ---- Node.js version check (need 22+) ----
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 22 ]; then
  echo "Node.js 22+ required. Installing via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y -qq nodejs
fi

# ---- Clone repo ----
echo "Cloning repository..."
cd /home/ubuntu
if [ -d "YouTubeResearchAI" ]; then
  cd YouTubeResearchAI
  git pull origin main
else
  git clone https://github.com/jongan69/YouTubeResearchAI.git
  cd YouTubeResearchAI
fi

# ---- Install Node deps ----
npm install --production

# ---- Configure env ----
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "⚠️  Edit .env with your API keys:"
  echo "   nano /home/ubuntu/YouTubeResearchAI/.env"
  echo ""
  echo "   Required: OPENAI_API_KEY=sk-..."
  echo "   Optional: OPERATOR_OPENAI_KEY=sk-... (for free tier)"
  echo "             FREE_TIER_DAILY_LIMIT=10"
fi

# ---- systemd service ----
echo "Setting up systemd service..."
sudo cp scripts/deploy/ytresearch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ytresearch
sudo systemctl restart ytresearch

# ---- Caddy reverse proxy ----
echo "Configuring Caddy..."
sudo cp scripts/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl enable caddy
sudo systemctl restart caddy

# ---- Firewall ----
echo "Configuring firewall..."
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# ---- Done ----
echo ""
echo "=== Setup Complete ==="
echo "Service: sudo systemctl status ytresearch"
echo "Logs:    sudo journalctl -u ytresearch -f"
echo "Caddy:   sudo systemctl status caddy"
echo ""
echo "Update your DNS A record to point to this server's IP:"
curl -s ifconfig.me && echo ""
