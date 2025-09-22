# Gource Video Generation for GenAIcode

This directory contains tools for generating animated visualization videos of the GenAIcode repository's development history using [Gource](https://gource.io/).

## What is Gource?

Gource is a software version control visualization tool that creates animated tree diagrams showing the evolution of a project over time. It displays:

- Files as branches and leaves
- Developers as colored dots moving around the tree
- Commits as real-time changes to the file structure
- A timeline showing the project's development history

## Generated Video

The script generates a high-quality MP4 video showing:

- **Title**: "GenAIcode - Development History"
- **Resolution**: 1920x1080 (Full HD)
- **Frame Rate**: 60 FPS
- **Duration**: Depends on repository history (~53 seconds for current repo)
- **Features**:
  - GenAIcode logo overlay
  - Date progression display
  - Smooth animations with bloom effects
  - Color-coded file types and developers

## Usage

### Using npm script (recommended):

```bash
npm run generate-video
```

### Using the script directly:

```bash
./scripts/generate-gource-video.sh
```

## Prerequisites

The script automatically handles most dependencies, but requires:

- **Git repository**: Must be run from the root of a Git repository
- **System packages**:
  - `gource` (automatically installed via apt)
  - `ffmpeg` (automatically installed via apt)
  - `xvfb` (for headless operation)

On Ubuntu/Debian systems, these will be installed automatically if missing.

## Output

The generated video will be saved as:

```
./videos/genaicode-development-history.mp4
```

## Customization

You can modify the script to customize various aspects:

- **Video duration**: Adjust `SECONDS_PER_DAY` (default: 0.1)
- **Resolution**: Change `RESOLUTION` (default: 1920x1080)
- **Frame rate**: Modify `FPS` (default: 60)
- **Visual effects**: Adjust bloom settings and colors
- **Output location**: Change `OUTPUT_DIR` and `VIDEO_NAME`

## Technical Details

The script works by:

1. Setting up a virtual display using Xvfb for headless operation
2. Running Gource to generate PPM frame stream
3. Piping the output directly to FFmpeg for H.264 encoding
4. Cleaning up temporary processes

## Troubleshooting

### "SDL initialization failed"

This error occurs when running without a display. The script handles this automatically by using Xvfb.

### "No such file or directory: videos/"

The script creates the output directory automatically. If this persists, check file permissions.

### Large file size

For very long project histories, consider:

- Increasing `SECONDS_PER_DAY` to create shorter videos
- Reducing resolution or frame rate
- Using different FFmpeg encoding settings

## Example Output

The generated video will show the development of GenAIcode from its first commit to the present, with:

- Animated file creation, modification, and deletion
- Developer avatars moving between different parts of the codebase
- A timeline showing dates as the project evolves
- The GenAIcode logo prominently displayed

Perfect for:

- Project presentations
- Team retrospectives
- Documentation
- Social media sharing
- Understanding project evolution patterns
