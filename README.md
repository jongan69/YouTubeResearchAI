# YouTubeResearchAI

A learning-focused fork of ClipCaptionAI. Drop YouTube links into `links.txt`, run one command, and get downloaded source video, timestamped transcript, structured JSON, and a deep research report based on the material.

This is for studying lectures, interviews, podcasts, tutorials, sermons, essays, debates, and long-form educational videos.

## Quick Start

```bash
cd /Users/jonathangan/Desktop/YouTubeResearchAI
npm install
cp .env.example .env
```

Add `OPENAI_API_KEY=...` to `.env`.

Put one YouTube URL per line in `links.txt`, then run:

```bash
npm run research
```

Or double-click `RUN.command`.

## Output

Every run creates a new folder:

```text
outputs/run-YYYY-MM-DD-HHMMSS/
  links.txt
  manifest.json
  downloads/
    video-title [id].mp4
  transcripts/
    video-slug.transcript.json
    video-slug.transcript.txt
    video-slug.timestamped.md
  reports/
    video-slug.research.json
    video-slug.research.md
```

## What The Report Includes

- Executive summary
- Detailed summary
- Core thesis
- Key ideas with explanations
- Timeline of important moments
- Terms and glossary
- Memorable quotes
- Claims worth verifying
- Study questions
- Practical applications
- Follow-up reading/search topics
- 7-day study plan

## Commands

```bash
npm run doctor
npm run research
npm run research -- --links "/path/to/links.txt"
npm run research -- --run-name my-study-run
npm run research -- --report-model gpt-4.1
npm run research -- --transcription-model whisper-1
```

Useful options:

| Option | Meaning |
| --- | --- |
| `--links FILE` | Links file. Defaults to `./links.txt`. |
| `--out-dir DIR` | Output root. Defaults to `outputs`. |
| `--run-name NAME` | Custom run folder name. |
| `--download-dir DIR` | Reuse or override the download folder. |
| `--transcription-model ID` | OpenAI transcription model. Default: `OPENAI_TRANSCRIPTION_MODEL` or `whisper-1`. |
| `--report-model ID` | OpenAI report model. Default: `OPENAI_REPORT_MODEL` or `gpt-4.1`. |
| `--prompt TEXT` | Extra transcription context for names, jargon, or acronyms. |
| `--chunk-seconds N` | Audio chunk size for long videos. Default: `180`. |
| `--skip-download` | Treat each link line as an already-downloaded local video path. |
| `--no-report` | Download and transcribe only. |

## Notes

The report is based on the transcript. It can identify claims worth checking, but it does not automatically browse the web or verify external facts.
