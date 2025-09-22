#!/bin/bash

# GenAIcode Gource Video Generation Script
# This script generates an animated visualization of the repository's development history

set -e

# Configuration
OUTPUT_DIR="./videos"
VIDEO_NAME="genaicode-development-history.mp4"
TEMP_FILE="/tmp/gource_output.ppm"

# Colors and styling
USER_IMAGE_DIR="./media"
LOGO_IMAGE="./media/logo-small.png"

# Video settings
RESOLUTION="1920x1080"
FPS="60"
SECONDS_PER_DAY="0.1"

echo "🎬 Generating Gource video for GenAIcode repository..."

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

# Check if we're in a git repository
if [ ! -d ".git" ]; then
    echo "Error: This script must be run from the root of a git repository"
    exit 1
fi

# Ensure we have full Git history (unshallow if needed)
echo "🔍 Checking Git history completeness..."
if git rev-parse --is-shallow-repository >/dev/null 2>&1; then
    IS_SHALLOW=$(git rev-parse --is-shallow-repository)
    if [ "$IS_SHALLOW" = "true" ]; then
        echo "📚 Repository is shallow, fetching full history..."
        git fetch --unshallow
        echo "✅ Full history fetched"
    fi
fi

echo "📊 Repository has $(git log --oneline | wc -l) commits"

# Create smaller logo if it doesn't exist
if [ ! -f "$LOGO_IMAGE" ] && [ -f "./media/logo.png" ]; then
    echo "🖼️  Creating smaller logo for video overlay..."
    if command -v convert > /dev/null 2>&1; then
        convert "./media/logo.png" -resize 300x171 "$LOGO_IMAGE"
        echo "✅ Created smaller logo: $LOGO_IMAGE"
    else
        echo "⚠️  ImageMagick not found. Using original logo (may appear large)."
        LOGO_IMAGE="./media/logo.png"
    fi
fi

# Generate the video
echo "🎨 Creating visualization..."

# Start Xvfb virtual display for headless operation
export DISPLAY=:99
Xvfb :99 -screen 0 1920x1080x24 > /dev/null 2>&1 &
XVFB_PID=$!

# Wait for Xvfb to start
sleep 2

# Generate gource output and pipe directly to ffmpeg
gource \
    --title "GenAIcode - Development History" \
    --logo "$LOGO_IMAGE" \
    --date-format "%Y-%m-%d" \
    --seconds-per-day "$SECONDS_PER_DAY" \
    --auto-skip-seconds 1 \
    --max-files 0 \
    --max-file-lag 0.1 \
    --file-idle-time 60 \
    --bloom-multiplier 1.2 \
    --bloom-intensity 0.75 \
    --hide filenames,mouse,progress \
    --stop-at-end \
    --font-size 22 \
    --output-framerate "$FPS" \
    --$RESOLUTION \
    --output-ppm-stream - \
    --background-colour 000000 \
    | ffmpeg -y -r "$FPS" -f image2pipe -vcodec ppm -i - \
    -vcodec libx264 -preset medium -pix_fmt yuv420p \
    -crf 18 -threads 0 \
    "$OUTPUT_DIR/$VIDEO_NAME"

# Clean up Xvfb
kill $XVFB_PID > /dev/null 2>&1

# Clean up is no longer needed as we pipe directly

echo "✅ Video generated successfully!"
echo "📁 Output: $OUTPUT_DIR/$VIDEO_NAME"
echo "📊 File size: $(du -h "$OUTPUT_DIR/$VIDEO_NAME" | cut -f1)"

# Show video information
if command -v ffprobe > /dev/null 2>&1; then
    echo "🎬 Video details:"
    ffprobe -v quiet -show_format -show_streams "$OUTPUT_DIR/$VIDEO_NAME" | grep -E "(duration|width|height|codec_name)" | head -5
fi