# Multi-Repository Gource Video Generation

This script creates animated visualizations combining multiple Git repositories using [Gource](https://gource.io/), showing the development activity across different projects during the same time period.

## What it does

The multi-repository script:
- Clones multiple repositories automatically
- Generates synchronized Gource logs for each repository
- Combines the logs into a unified timeline
- Creates a single video showing all repositories' development activity
- Uses color-coding and path prefixes to distinguish between repositories

## Usage

### Quick Start

```bash
npm run generate-multi-repo-video
```

### Manual execution

```bash
./scripts/generate-multi-repo-video.sh
```

## Configuration

Edit the `REPOSITORIES` array in the script to include your repositories:

```bash
REPOSITORIES=(
    "https://github.com/username/repo1:repo1:#FF6B6B"
    "https://github.com/username/repo2:repo2:#4ECDC4"
    "https://github.com/username/repo3:repo3:#45B7D1"
)
```

Format: `"URL:NAME:COLOR"`
- **URL**: GitHub repository URL
- **NAME**: Short name for the repository (used in file paths)
- **COLOR**: Hex color code for visual distinction

## Features

### Automatic Repository Management
- Clones repositories to temporary directory
- Fetches full Git history automatically
- Handles both shallow and complete clones

### Time Synchronization
- Uses the main repository's date range as reference
- Filters all repositories to the same time period
- Ensures consistent timeline across all projects

### Visual Enhancements
- Repository-specific path prefixes (e.g., `/genaicode/src/`, `/gamedev/docs/`)
- Color-coded visualization for different repositories
- Professional logo overlay and styling

### Technical Features
- Headless operation using xvfb
- High-quality video output (1920x1080, 60fps)
- Efficient log processing and merging
- Automatic cleanup of temporary files

## Output

The script generates:
- `./videos/multi-repo-development-history.mp4`
- Combined visualization showing all repositories
- Timeline covering the same period as the main repository

## Prerequisites

Required packages (automatically checked):
- `gource` - For generating visualizations
- `ffmpeg` - For video encoding
- `git` - For repository operations
- `xvfb` - For headless display

Install on Ubuntu/Debian:
```bash
sudo apt install gource ffmpeg git xvfb
```

## Customization

### Video Settings
Edit these variables in the script:
```bash
RESOLUTION="1920x1080"    # Video resolution
FPS="60"                  # Frames per second
SECONDS_PER_DAY="0.1"     # Time compression
```

### Visual Styling
```bash
LOGO_IMAGE="./media/logo-small.png"  # Logo overlay
VIDEO_NAME="multi-repo-development-history.mp4"  # Output filename
```

## How it Works

1. **Repository Processing**
   - Clones each repository to `/tmp/gource_multi_repo/`
   - Ensures full Git history is available
   - Generates Gource log for each repository

2. **Log Preparation**
   - Adds repository prefix to all file paths
   - Filters logs to match the date range of the main repository
   - Combines all logs into a unified timeline

3. **Video Generation**
   - Sorts combined log chronologically
   - Runs Gource with the merged log
   - Outputs high-quality MP4 video

4. **Cleanup**
   - Removes temporary files and directories
   - Keeps only the final video output

## Example Use Cases

- **Portfolio Visualization**: Show work across multiple projects
- **Team Activity**: Visualize distributed development across repositories
- **Project Comparison**: Compare development patterns between projects
- **Presentation Material**: Create engaging demos of development activity

## Troubleshooting

### Missing Dependencies
```bash
❌ Missing dependency: gource
Please install: sudo apt install gource ffmpeg git xvfb
```

### Repository Access Issues
- Ensure you have access to all configured repositories
- For private repos, set up SSH keys or authentication

### Large Repository Performance
- The script may take time with large repositories
- Consider using `--start-date` and `--stop-date` for specific periods
- Temporary files require sufficient disk space

## Advanced Configuration

### Adding GitHub Activity Integration
The script can be extended to include GitHub contribution data by:
1. Using GitHub API to fetch contribution statistics
2. Converting contribution data to Gource log format
3. Merging with repository logs

### Custom Color Schemes
Modify the color codes in the `REPOSITORIES` array to match your branding or preferences.

### Date Range Customization
By default, the script uses the main repository's full date range. You can modify the `get_date_range()` function to use custom dates.

## Comparison with Single Repository Script

| Feature | Single Repo | Multi Repo |
|---------|-------------|------------|
| Repositories | 1 | Multiple |
| Setup | Simple | Configurable |
| Timeline | Full history | Synchronized |
| File paths | Original | Prefixed |
| Use case | Project focus | Portfolio/comparison |

Both scripts share the same high-quality output, logo optimization, and headless operation features.