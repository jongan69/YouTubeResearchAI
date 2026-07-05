#!/bin/zsh
set -e

pause_before_close() {
  echo ""
  read -k 1 "reply?Press any key to close..."
}

TRAPERR() {
  local exit_code=$?
  echo ""
  echo "The research pipeline failed before finishing."
  echo "Scroll up for the error. You can run RUN.command again after fixing it."
  pause_before_close
  exit $exit_code
}

SCRIPT_DIR="${0:a:h}"
cd "$SCRIPT_DIR"

echo "YouTubeResearchAI"
echo "================="
echo "Project folder: $SCRIPT_DIR"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on PATH."
  echo "Install Node.js, then double-click RUN.command again."
  pause_before_close
  exit 1
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp is required but was not found on PATH."
  echo "Install it with: brew install yt-dlp"
  pause_before_close
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffmpeg and ffprobe are required but were not found on PATH."
  echo "Install them with: brew install ffmpeg"
  pause_before_close
  exit 1
fi

if [ ! -f ".env" ]; then
  echo "Missing .env file. Copy .env.example to .env and add OPENAI_API_KEY=..."
  pause_before_close
  exit 1
fi

if [ ! -f "links.txt" ]; then
  cat > links.txt <<'EOF'
# Put one YouTube URL per line.
# Blank lines and comments are ignored.
EOF
fi

if ! grep -Eq '^[[:space:]]*https?://' links.txt; then
  echo "No YouTube links found in links.txt."
  echo "Opening links.txt now. Add one URL per line, save it, then run again."
  open -a TextEdit links.txt
  pause_before_close
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing project dependencies. This only happens the first time..."
  npm install
  echo ""
fi

echo "Running research pipeline from links.txt..."
echo ""
npm run research -- --links "$SCRIPT_DIR/links.txt" --out-dir "$SCRIPT_DIR/outputs"

echo ""
echo "Done. Opening output folder..."
open "$SCRIPT_DIR/outputs"
pause_before_close
