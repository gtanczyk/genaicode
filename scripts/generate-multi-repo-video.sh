#!/bin/bash

# Multi-Repository Gource Video Generation Script
# This script generates an animated visualization combining multiple repositories

set -e

# Configuration
OUTPUT_DIR="./videos"
VIDEO_NAME="multi-repo-development-history.mp4"
TEMP_DIR="/tmp/gource_multi_repo"
COMBINED_LOG="$TEMP_DIR/combined.log"

# Video settings
RESOLUTION="1920x1080"
FPS="60"
SECONDS_PER_DAY="0.1"

# Repository configuration
# Add repositories in the format: "URL:NAME:COLOR"
REPOSITORIES=(
    "https://github.com/gtanczyk/genaicode:genaicode:#FF6B6B"
    "https://github.com/gamedevpl/www.gamedev.pl:gamedev:#4ECDC4"
)

# Colors and styling
LOGO_IMAGE="./media/logo-small.png"

echo "🎬 Generating multi-repository Gource video..."

# Create output and temp directories
mkdir -p "$OUTPUT_DIR"
mkdir -p "$TEMP_DIR"

# Function to clone repository and generate log
clone_and_generate_log() {
    local repo_url="$1"
    local repo_name="$2"
    local repo_color="$3"
    local repo_dir="$TEMP_DIR/$repo_name"
    local log_file="$TEMP_DIR/${repo_name}.log"
    
    echo "📦 Processing repository: $repo_name"
    
    # Clone repository
    if [ ! -d "$repo_dir" ]; then
        echo "🔄 Cloning $repo_url..."
        git clone "$repo_url" "$repo_dir"
    fi
    
    cd "$repo_dir"
    
    # Ensure full history
    if git rev-parse --is-shallow-repository >/dev/null 2>&1; then
        IS_SHALLOW=$(git rev-parse --is-shallow-repository)
        if [ "$IS_SHALLOW" = "true" ]; then
            echo "📚 Fetching full history for $repo_name..."
            git fetch --unshallow
        fi
    fi
    
    echo "📊 Repository $repo_name has $(git log --oneline | wc -l) commits"
    
    # Generate Gource log with repository prefix
    echo "📝 Generating log for $repo_name..."
    gource --output-custom-log "$log_file" .
    
    # Add repository prefix to file paths and set user color
    sed -i "s#|/#|/$repo_name/#g" "$log_file"
    
    echo "✅ Log generated for $repo_name"
}

# Function to get date range from current repository
get_date_range() {
    cd "/home/runner/work/genaicode/genaicode"
    
    # Get the earliest and latest commit dates
    EARLIEST_DATE=$(git log --reverse --format="%ai" | head -1 | cut -d' ' -f1)
    LATEST_DATE=$(git log --format="%ai" | head -1 | cut -d' ' -f1)
    
    echo "$EARLIEST_DATE|$LATEST_DATE"
}

# Function to filter log by date range
filter_log_by_date() {
    local log_file="$1"
    local start_date="$2"
    local end_date="$3"
    
    echo "🔍 Filtering $log_file for date range $start_date to $end_date"
    
    # Convert dates to timestamps
    start_timestamp=$(date -d "$start_date" +%s)
    end_timestamp=$(date -d "$end_date" +%s)
    
    # Filter log entries by timestamp
    awk -F'|' -v start="$start_timestamp" -v end="$end_timestamp" '
        $1 >= start && $1 <= end
    ' "$log_file" > "${log_file}.filtered"
    
    mv "${log_file}.filtered" "$log_file"
}

# Check dependencies
echo "🔍 Checking dependencies..."
for cmd in gource ffmpeg git xvfb-run; do
    if ! command -v "$cmd" > /dev/null 2>&1; then
        echo "❌ Missing dependency: $cmd"
        echo "Please install: sudo apt install gource ffmpeg git xvfb"
        exit 1
    fi
done

# Get date range from main repository
DATE_RANGE=$(get_date_range)
START_DATE=$(echo "$DATE_RANGE" | cut -d'|' -f1)
END_DATE=$(echo "$DATE_RANGE" | cut -d'|' -f2)

echo "🗓️ Using date range: $START_DATE to $END_DATE"

# Process each repository
for repo_config in "${REPOSITORIES[@]}"; do
    IFS=':' read -r repo_url repo_name repo_color <<< "$repo_config"
    
    # Clean up any extra slashes or formatting issues
    repo_url=$(echo "$repo_url" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
    repo_name=$(echo "$repo_name" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
    repo_color=$(echo "$repo_color" | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
    
    clone_and_generate_log "$repo_url" "$repo_name" "$repo_color"
    
    # Filter log by date range
    filter_log_by_date "$TEMP_DIR/${repo_name}.log" "$START_DATE" "$END_DATE"
done

# Combine all logs
echo "🔗 Combining repository logs..."
cat "$TEMP_DIR"/*.log | sort -n > "$COMBINED_LOG"

echo "📊 Combined log has $(wc -l < "$COMBINED_LOG") entries"

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

# Generate video
echo "🎨 Creating multi-repository visualization..."

# Use xvfb-run for headless operation
xvfb-run -a gource \
    "$COMBINED_LOG" \
    --title "Multi-Repository Development History" \
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
    --start-date "$START_DATE" \
    --stop-date "$END_DATE" \
    --output-ppm-stream - \
    --background-colour 000000 \
    | ffmpeg -y -r "$FPS" -f image2pipe -vcodec ppm -i - \
    -vcodec libx264 -preset medium -pix_fmt yuv420p \
    -crf 18 -threads 0 \
    "$OUTPUT_DIR/$VIDEO_NAME"

echo "✅ Multi-repository video generated successfully!"
echo "📁 Output: $OUTPUT_DIR/$VIDEO_NAME"
echo "📊 File size: $(du -h "$OUTPUT_DIR/$VIDEO_NAME" | cut -f1)"

# Clean up temporary files
echo "🧹 Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

# Show video information
if command -v ffprobe > /dev/null 2>&1; then
    echo "🎬 Video details:"
    ffprobe -v quiet -show_format -show_streams "$OUTPUT_DIR/$VIDEO_NAME" | grep -E "(duration|width|height|codec_name)" | head -5
fi

echo "🎉 Multi-repository visualization complete!"