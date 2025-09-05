# Lansingerland Council Meeting Scraper

A robust TypeScript scraper that extracts council meeting data from the Lansingerland public portal and produces aligned transcript JSON files following the standardized format. The scraper processes meeting agendas, downloads WebVTT captions, and aligns transcripts with speakers and agenda items.

## Features

- ✅ **Complete Meeting Extraction**: Scrapes meeting metadata, agenda items, and speaker time windows
- ✅ **WebVTT Processing**: Downloads and parses Dutch corrected subtitles
- ✅ **Smart Alignment**: Matches transcript cues to speakers and agenda items with configurable tolerance
- ✅ **Robust Error Handling**: Rate limiting, retries, and comprehensive logging
- ✅ **Multiple Output Formats**: Standard JSON transcript format or simplified meeting format
- ✅ **Future Meeting Support**: Handles meetings without available video content
- ✅ **Comprehensive Testing**: Acceptance tests with known working examples
- ✅ **Auto-Discovery**: Automatically discover and process meetings from the portal calendar

## Quick Start

```bash
# Install dependencies
npm install

# Scrape a single meeting
npm run scrape -- "https://lansingerland.bestuurlijkeinformatie.nl/Agenda/Index/8f592da7-0c24-41ac-9423-c4cbe40252a0"

# Auto-discover and process recent meetings
npm run scrape -- auto --days -30 --meeting-types "Gemeenteraad"

# Discover available meetings
npm run scrape -- discover --days -90

# Run acceptance tests
npm test
```

## Installation

```bash
git clone <repository-url>
cd lansingerland-council-scraper
npm install
npm run build  # Optional: compile TypeScript
```

## Usage

### Command Line Interface

#### Single Meeting

```bash
# Basic usage
npm run scrape -- <agenda-url>

# With options
npm run scrape -- <agenda-url> --output ./my-output --rate-limit 2000 --simplified

# Example
npm run scrape -- "https://lansingerland.bestuurlijkeinformatie.nl/Agenda/Index/8f592da7-0c24-41ac-9423-c4cbe40252a0" --output ./output
```

#### Auto-Discovery and Processing

```bash
# Discover meetings from the portal calendar
npm run scrape -- discover --days -30 --meeting-types "Gemeenteraad"

# Auto-discover and process recent council meetings
npm run scrape -- auto --days -30 --meeting-types "Gemeenteraad" --output ./output

# Auto-discover and process all meeting types in the past 90 days
npm run scrape -- auto --days -90 --output ./output --continue-on-error

# Discover upcoming meetings
npm run scrape -- discover --days +30
```

#### Batch Processing

```bash
# Create a file with URLs (one per line)
echo "https://lansingerland.bestuurlijkeinformatie.nl/Agenda/Index/8f592da7-0c24-41ac-9423-c4cbe40252a0" > urls.txt

# Process batch
npm run scrape -- batch urls.txt --output ./output --continue-on-error
```

### CLI Options

#### Single Meeting Options

| Option | Description | Default |
|--------|-------------|---------|
| `--output, -o` | Output directory | `./output` |
| `--rate-limit, -r` | Rate limit in milliseconds | `1000` |
| `--grace-window, -g` | Alignment grace window in seconds | `0.35` |
| `--skip-existing, -s` | Skip if output file already exists | `false` |
| `--simplified` | Use simplified JSON output format | `false` |
| `--continue-on-error, -c` | Continue batch processing on errors | `false` |

#### Discovery Options

| Option | Description | Default |
|--------|-------------|---------|
| `--days` | Date range in days (negative for past, positive for future) | `-365` |
| `--meeting-types` | Filter by meeting type (e.g., "Gemeenteraad", "Commissie") | All types |
| `--from-date` | Start date (YYYY-MM-DD format) | 1 year ago |
| `--to-date` | End date (YYYY-MM-DD format) | 1 year from now |
| `--include-cancelled` | Include cancelled meetings | `false` |

## Output Format

The scraper produces JSON files following the standardized transcript format with these key sections:

### Standard Format

```json
{
  "format_version": "1.0",
  "import_metadata": {
    "source": "lansingerland_scraper",
    "created_at": "2025-01-15T14:30:00Z",
    "created_by": "Claude Code Lansingerland Scraper"
  },
  "video": {
    "title": "Gemeenteraad",
    "filename": "gemeentelansingerland_20250327_1.json",
    "date": "2025-03-27",
    "duration": 10323,
    "source": "Gemeente Lansingerland",
    "dataset": "lansingerland_gemeenteraad",
    "total_segments": 245
  },
  "segments": [
    {
      "segment_id": "001",
      "speaker_name": "Jules Bijl",
      "transcript_text": "Dames en heren, ik zou graag willen beginnen.",
      "video_seconds": 83,
      "timestamp_start": "00:01:23",
      "timestamp_end": "00:01:25",
      "duration_seconds": 2,
      "word_count": 8,
      "char_count": 45,
      "segment_type": "spoken",
      "agenda_item": "Opening"
    }
  ]
}
```

### Simplified Format (--simplified flag)

```json
{
  "meeting_id": "gemeentelansingerland_20250327_1",
  "date": "2025-03-27",
  "title": "Gemeenteraad",
  "agenda_url": "https://...",
  "video_available": true,
  "agenda": [
    {
      "id": "item_1",
      "title": "Opening",
      "order": 1,
      "speakers": [
        {
          "start_time": 76,
          "end_time": 454,
          "speaker_name": "Jules Bijl"
        }
      ]
    }
  ],
  "transcript": [
    {
      "start": 83,
      "end": 85,
      "text": "Dames en heren, ik zou graag willen beginnen.",
      "speaker": "Jules Bijl",
      "agenda_item": "Opening"
    }
  ]
}
```

## Configuration

Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HTTP_TIMEOUT` | HTTP request timeout in ms | `30000` |
| `HTTP_RATE_LIMIT` | Rate limit between requests in ms | `1000` |
| `OUTPUT_DIR` | Default output directory | `./output` |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | `info` |
| `WEBCAST_USER_AGENT` | User-Agent for webcast requests | Mozilla/5.0... |
| `WEBCAST_REFERER` | Referer header for webcast requests | https://lansingerland... |
| `ALIGNMENT_GRACE_WINDOW` | Speaker alignment tolerance in seconds | `0.35` |
| `RETRY_ATTEMPTS` | Max retry attempts for failed requests | `3` |
| `RETRY_DELAY` | Base delay for retries in ms | `1000` |

## Architecture

### Core Components

- **MeetingDiscovery**: Automatically discovers meetings from the Lansingerland calendar portal
- **AgendaScraper**: Extracts meeting metadata and speaker windows from HTML
- **WebcastResolver**: Interfaces with Company Webcast API to resolve UUIDs and download VTT
- **VTTProcessor**: Parses WebVTT content and extracts timestamped cues
- **TranscriptAligner**: Aligns transcript cues with speakers and agenda items
- **JSONTranscriptBuilder**: Generates output JSON in various formats

### Data Flow

#### Auto-Discovery Mode
1. **Calendar Discovery** → Parse Lansingerland calendar for meetings by date range and type
2. **Meeting Filtering** → Apply date filters, meeting type filters, and exclusions
3. **Batch Processing** → Process each discovered meeting using standard flow below

#### Single Meeting Mode
1. **Discover** → Extract meeting UUID from agenda URL
2. **Scrape** → Parse HTML for meeting metadata, agenda items, and speaker windows
3. **Resolve** → Convert webcast code to internal UUID via Company Webcast API
4. **Download** → Fetch WebVTT subtitle track (prefer Dutch corrected)
5. **Parse** → Extract timestamped cues from VTT content
6. **Align** → Match cues to speakers using time windows (±0.35s tolerance)
7. **Generate** → Produce standardized JSON output

### Company Webcast API Integration

The scraper uses these public endpoints:

- **Info**: `GET /players/{webcastCode}/info` → Get UUID and metadata
- **VTT List**: `GET /players/{uuid}/vtt/` → List available subtitle tracks
- **VTT Download**: `GET /players/{uuid}/vtt/{path}/{id}` → Download VTT content

**Important**: Signed endpoints like `/eventsv2/list` and `/resources` are not used as they require authentication keys.

## Testing

### Run All Tests

```bash
npm test
```

### Individual Test Suites

```bash
# Test agenda discovery
npm run test -- --discovery

# Test webcast endpoints
npm run test -- --webcast

# Verbose output
VERBOSE_TESTS=1 npm test
```

### Known Working Examples

The tests validate against these known working meetings:

1. **March 27, 2025**: UUID `fcdc1d3a-0bbb-4bee-9e33-3b1bc449b8a3`
2. **May 22, 2025**: UUID `ef1cb62f-dbee-46b8-bb53-79890b0262f3`

## Logging

Logs are written to the `logs/` directory:

- **scraper.log**: All application logs
- **error.log**: Error-level logs only
- **processing.jsonl**: Machine-readable processing status (JSONL format)

### Log Format

```json
{
  "timestamp": "2025-01-15T14:30:00.123Z",
  "level": "info",
  "message": "processing_status",
  "meetingId": "gemeentelansingerland_20250327_1",
  "status": "success",
  "segments": 245,
  "processingTime": 12543
}
```

## Error Handling & Robustness

- **Rate Limiting**: Configurable delays between requests (default 1s)
- **Retry Logic**: Exponential backoff for failed requests (max 3 attempts)
- **Graceful Degradation**: Continues processing when possible, logs issues
- **Idempotent Processing**: Skips existing files when `--skip-existing` is used
- **CloudFront Bypass**: Uses proper headers to avoid 403 errors
- **Future Meeting Support**: Handles meetings without available video content

## Troubleshooting

### Common Issues

#### "403 ERROR" from Company Webcast

**Problem**: CloudFront blocking requests
**Solution**: Ensure proper User-Agent and Referer headers are set in `.env`

#### "No VTT tracks available"

**Problem**: Meeting hasn't been processed or is too recent
**Solution**: Check if meeting has concluded and subtitles are generated

#### "Alignment validation failed"

**Problem**: Poor speaker alignment due to missing or incorrect speaker data
**Solution**: Check agenda page for "Sprekers" sections, adjust grace window

#### Rate limiting issues

**Problem**: Too many requests causing failures
**Solution**: Increase `--rate-limit` parameter (e.g., `--rate-limit 2000`)

### Debug Mode

```bash
LOG_LEVEL=debug npm run scrape -- <url>
```

### Verbose Testing

```bash
VERBOSE_TESTS=1 npm test
```

## Performance

### Typical Processing Times

- Small meeting (~1 hour): 30-60 seconds
- Large meeting (~3 hours): 2-5 minutes
- Batch processing: ~1-2 minutes per meeting

### Optimization Tips

- Use `--skip-existing` for incremental processing
- Increase `--rate-limit` if experiencing failures
- Process during off-peak hours to reduce server load

## Known Limitations

1. **Webcast Dependency**: Requires Company Webcast API availability
2. **HTML Structure**: Sensitive to changes in Lansingerland portal structure
3. **Speaker Detection**: Relies on "Sprekers" sections being present and correctly formatted
4. **Time Alignment**: ±0.35s tolerance may not capture all edge cases
5. **Dutch Language**: Optimized for Dutch content and date formats

## Development

### Project Structure

```
src/
├── alignment/          # Speaker and agenda alignment
├── builders/          # JSON output builders
├── scraper/           # Core scraping and discovery components
│   ├── AgendaScraper.ts
│   ├── MeetingDiscovery.ts  # NEW: Auto-discovery functionality
│   ├── VTTProcessor.ts
│   └── WebcastResolver.ts
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
└── tests/             # Acceptance tests
```

### Adding New Features

1. Follow existing TypeScript patterns
2. Add comprehensive error handling
3. Include logging for debugging
4. Write tests for new functionality
5. Update documentation

### Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for your changes
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues or questions:

1. Check the troubleshooting section
2. Review the logs in `logs/` directory
3. Run tests to verify system functionality
4. Open an issue with detailed error information

---

**Generated with [Claude Code](https://claude.ai/code)**

**Co-Authored-By: Claude <noreply@anthropic.com>**