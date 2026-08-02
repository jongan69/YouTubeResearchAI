# YouTubeResearchAI

A learning-focused fork of ClipCaptionAI. Drop YouTube links into `links.txt`, run one command, and get downloaded source video, timestamped transcript, structured JSON, and a deep research report based on the material.

This is for studying lectures, interviews, podcasts, tutorials, sermons, essays, debates, and long-form educational videos.

## Quick Start

```bash
cd /Users/jonathangan/Desktop/YouTubeResearchAI
npm install
cp .env.example .env
```

### Choose your AI provider

Edit `.env` to pick your AI provider and add your API key:

**OpenAI** (default):
```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-key-here
```

**Anthropic Claude** (transcription requires an OpenAI key too):
```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key-here
OPENAI_API_KEY=sk-your-openai-key-here  # needed for transcription
```

**Google Gemini** (transcription requires an OpenAI key too):
```env
AI_PROVIDER=google
GOOGLE_API_KEY=your-google-api-key-here
OPENAI_API_KEY=sk-your-openai-key-here  # needed for transcription
```

**OpenAI-compatible** (Groq, DeepSeek, Ollama, etc.):
```env
AI_PROVIDER=openai-compat
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.groq.com/openai/v1
```

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

## Supported AI Providers

| Provider | Report Generation | Transcription | API Key(s) |
|---|---|---|---|
| **OpenAI** | Responses API (GPT-5.5, etc.) | Whisper | `OPENAI_API_KEY` |
| **Anthropic** | Messages API (Claude) | ❌ (needs OpenAI) | `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` |
| **Google** | Gemini API | ❌ (needs OpenAI) | `GOOGLE_API_KEY` + `OPENAI_API_KEY` |
| **OpenAI-compat** | Chat Completions (Groq, DeepSeek, Ollama, etc.) | Whisper (if supported) | `OPENAI_API_KEY` + `OPENAI_BASE_URL` |

### Feature mapping

| OpenAI Feature | Anthropic | Google | OpenAI-compat |
|---|---|---|---|
| Reasoning effort | Extended thinking budget | thinkingConfig | System prompt guidance |
| Text verbosity | System prompt instruction | System prompt instruction | System prompt instruction |
| JSON structured output | Tool use with tool_choice | response_schema | json_schema / json_object |

## Commands

```bash
npm run doctor
npm run research
npm run research -- --links "/path/to/links.txt"
npm run research -- --run-name my-study-run
npm run research -- --report-model gpt-5.5
npm run research -- --reasoning-effort medium --verbosity medium
npm run research -- --transcription-model whisper-1
npm run research -- --transcript "outputs/run-.../transcripts/video.timestamped.md"
```

Useful options:

| Option | Meaning |
| --- | --- |
| `--links FILE` | Links file. Defaults to `./links.txt`. |
| `--out-dir DIR` | Output root. Defaults to `outputs`. |
| `--run-name NAME` | Custom run folder name. |
| `--download-dir DIR` | Reuse or override the download folder. |
| `--ai-provider ID` | Override `AI_PROVIDER` from .env. |
| `--transcription-model ID` | Transcription model. Default from env or `whisper-1`. |
| `--transcription-provider ID` | Override `TRANSCRIPTION_PROVIDER` from .env. |
| `--report-model ID` | Report model. Default depends on provider. |
| `--reasoning-effort LEVEL` | `low`, `medium`, or `high`. Behavior varies by provider. |
| `--verbosity LEVEL` | `low`, `medium`, or `high`. Behavior varies by provider. |
| `--max-output-tokens N` | Report token budget. Default varies by provider. |
| `--report-chunk-chars N` | Chunk transcript only above this size. Default: 100000 for large-context models, 18000 otherwise. |
| `--prompt TEXT` | Extra transcription context for names, jargon, or acronyms. |
| `--chunk-seconds N` | Audio chunk size for long videos. Default: `180`. |
| `--transcript FILE` | Generate a report from an existing transcript without downloading or transcribing again. |
| `--title TEXT` | Optional report title when using `--transcript`. |
| `--source TEXT` | Optional source URL/path when using `--transcript`. |
| `--skip-download` | Treat each link line as an already-downloaded local video path. |
| `--no-report` | Download and transcribe only. |

## Resume After A Report Failure

If download/transcription succeeded but report generation failed, reuse the saved transcript:

```bash
npm run research -- \
  --transcript "outputs/run-2026-07-05-023714/transcripts/clean-code-horrible-performance-td5nrevftbu.timestamped.md" \
  --title "Clean Code, Horrible Performance"
```

This creates a new report-only run and avoids paying for transcription again.

## Notes

The report is based on the transcript. It can identify claims worth checking, but it does not automatically browse the web or verify external facts.

## Report Quality

The report generator defaults to `gpt-5.5` through the Responses API. It uses structured outputs for reliable JSON plus a polished Markdown article. The default `medium` reasoning and `medium` verbosity settings are meant to create high-grade, readable article-style reports without turning every video into an overly long white paper.

Reports are written as standalone documents. They should explain the subject directly and provide maximum value without requiring the reader to watch the source video or know that the report came from a transcript.

For GPT-5.5, the app keeps most normal-length transcripts intact instead of pre-summarizing them first. That usually produces better standalone articles because the final model can reason over the original material directly.

For more exhaustive teaching-style reports:

```bash
npm run research -- --reasoning-effort high --verbosity high --max-output-tokens 32000
```

For cheaper/faster reports:

```bash
npm run research -- --report-model gpt-5.4-mini --reasoning-effort low --verbosity medium
```

### Using Anthropic Claude

```bash
npm run research -- --report-model claude-opus-5 --reasoning-effort high
```

### Using Google Gemini

```bash
npm run research -- --report-model gemini-2.5-pro
```

### Using Groq (OpenAI-compatible)

```bash
npm run research -- --report-model llama-3.3-70b-versatile
```
