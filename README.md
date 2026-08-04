<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jongan69/YouTubeResearchAI/main/imageAssets/youtube-research-ai-horizontal-dark.svg">
    <img src="https://raw.githubusercontent.com/jongan69/YouTubeResearchAI/main/imageAssets/youtube-research-ai-horizontal-light.svg" alt="YouTube Research AI" width="600">
  </picture>
</p>

**Automated academic research pipeline.** Download a video from any of 1,750+ supported sites (YouTube, Vimeo, Twitch, TikTok, academic platforms, and more), transcribe it with word-level timestamps, search peer-reviewed literature across four academic databases, verify claims against the evidence, and generate a fully cited research report — all with one command.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-brightgreen)](https://nodejs.org)
[![Provider](https://img.shields.io/badge/AI-OpenAI%20%7C%20Anthropic%20%7C%20Google%20%7C%20Compatible-purple)](#-ai-providers)

---

## What It Does

YouTube Research AI transforms passive video watching into **active academic research**. It's not a summarizer — it's a full research pipeline that treats a video as a primary source and builds a cited, verified research report around it.

### The Pipeline

```
Video URL → Download (yt-dlp) → Extract Audio (ffmpeg) → Transcribe (Whisper) 
  → Domain Detection → Literature Search (arXiv, Semantic Scholar, CrossRef, OpenAlex) 
  → Evidence Synthesis → Claim Verification → Deep Research Iterations 
  → Cited Report Generation → Reference Formatting
```

### Output Per Video

| Output File | Contents |
|---|---|
| `transcripts/<slug>.transcript.json` | Full transcription with word-level timestamps |
| `transcripts/<slug>.transcript.txt` | Plain text transcript |
| `transcripts/<slug>.timestamped.md` | Timestamped transcript with `[HH:MM:SS]` markers |
| `reports/<slug>.research.json` | Structured research data (JSON) |
| `reports/<slug>.research.md` | **Polished standalone research article with citations** |
| `research/search-queries.jsonl` | Audit log of every academic search query |
| `research/sources.json` | All retrieved and selected sources |
| `synthesis/synthesis.md` | Cross-source synthesis (multi-video mode) |

### What the Report Contains

- **Executive summary** with key findings
- **Core thesis** extracted from the material
- **Detailed summary** of all substantive content
- **Key ideas** with explanations and significance
- **Timeline** of important moments with timestamps
- **Glossary** of technical terms and definitions
- **Memorable quotes** preserved verbatim
- **Claims to verify** — flagging assertions needing evidence
- **Peer-reviewed citations** — inline numbered references to academic sources
- **Evidence quality assessment** — confidence level per claim (well-supported, plausible, contested, speculative, opinion)
- **Source quality rating** — overall epistemic quality of the source material
- **Literature gap analysis** — what the academic literature covers that the video misses
- **Research methods section** — describing how the automated research was conducted
- **Formatted reference list** — APA, Chicago, or IEEE style
- **Study questions** and **practical applications**
- **Follow-up research** recommendations
- **7-day study plan** for deep learning

---

## Quick Start

### Prerequisites

- **Node.js 22+** — [Download](https://nodejs.org)
- **yt-dlp** — `brew install yt-dlp` (macOS) or `pip install yt-dlp`
- **ffmpeg** — `brew install ffmpeg` (macOS) or `apt install ffmpeg`
- **An AI provider API key** — OpenAI, Anthropic, Google, or OpenAI-compatible

### Install

```bash
git clone https://github.com/jongan69/YouTubeResearchAI.git
cd YouTubeResearchAI
npm install
cp .env.example .env
```

### Configure

Edit `.env` with your AI provider API key:

```env
# OpenAI (recommended for full feature set)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here

# Or Anthropic Claude
# AI_PROVIDER=anthropic
# ANTHROPIC_API_KEY=sk-ant-your-key-here
# OPENAI_API_KEY=sk-your-key-here  # needed for Whisper transcription

# Or Google Gemini
# AI_PROVIDER=google
# GOOGLE_API_KEY=your-key-here
# OPENAI_API_KEY=sk-your-key-here  # needed for Whisper transcription

# Or any OpenAI-compatible endpoint (Groq, DeepSeek, Ollama, etc.)
# AI_PROVIDER=openai-compat
# OPENAI_API_KEY=your-key-here
# OPENAI_BASE_URL=https://api.groq.com/openai/v1
```

### Run

```bash
# Add video URLs to links.txt (one per line — any site yt-dlp supports)
echo "https://www.youtube.com/watch?v=VIDEO_ID" > links.txt

# Basic run — transcript + study-guide report
npm run research

# PhD-grade research — full literature search + citations + evidence verification
npm run research -- --research --verify

# Maximum depth — deep iterative research with all features
npm run research -- --research --research-depth deep --verify --citation-style apa --max-sources 20
```

Or double-click `RUN.command` on macOS.

### Verify Setup

```bash
npm run doctor
```

---

## Features

### 🔬 Automated Literature Research

The system searches **four free academic databases** simultaneously for every claim in the video:

| Database | Coverage | Authentication |
|---|---|---|
| **arXiv** | CS, physics, math, statistics preprints | None (polite pool) |
| **Semantic Scholar** | 200M+ papers across all disciplines | Free API key (optional, raises rate limit) |
| **CrossRef** | 150M+ peer-reviewed journal articles, proceedings, chapters | None (polite pool with mailto) |
| **OpenAlex** | 250M+ works, broadest open-access coverage | None |

**How it works:**
1. **Query planning** — The LLM extracts 3–6 researchable topics from the transcript and generates 2–3 precise academic search queries per topic
2. **Parallel search** — Queries are sent to all enabled databases with controlled concurrency
3. **Deduplication and scoring** — Results are merged by DOI, scored by citation count + recency + keyword relevance
4. **Source injection** — Selected papers are injected into the report prompt so the LLM can cite them inline
5. **Citation validation** — Inline `[S1]`…`[Sn]` markers are validated against the fetched metadata; hallucinated citations are pruned
6. **Reference formatting** — A formatted bibliography is appended in APA, Chicago, or IEEE style

### 🧪 Evidence Synthesis & Claim Verification

With `--verify`, each claim extracted from the video is compared against the retrieved literature:

- **Well-supported** ✅ — Multiple papers agree
- **Plausible** 🟡 — Consistent with literature but not directly tested
- **Contested** ⚠️ — Literature shows genuine disagreement
- **Speculative** ❓ — No evidence found in retrieved sources
- **Opinion** 💬 — Normative claim, not empirically verifiable

Supporting and contradicting sources are listed per claim, and an **Evidence Quality Assessment** section is appended to the report.

### 🎓 Domain-Specific Research

Five academic domain profiles automatically tailor the research strategy:

| Domain | Detection Triggers | Preferred APIs | Evaluation Standards |
|---|---|---|---|
| **Computer Science** | algorithm, API, Rust, React, ML, GPU… | arXiv, Semantic Scholar | Peer-reviewed proceedings, benchmark rigor, reproducibility |
| **Medicine** | clinical, diagnosis, RCT, trial, drug… | Semantic Scholar, CrossRef | Evidence hierarchy, sample size, conflicts of interest |
| **Social Sciences** | economics, psychology, policy, survey… | CrossRef, Semantic Scholar | Causal identification, sample representativeness, replication |
| **Humanities** | philosophy, history, ethics, discourse… | CrossRef, OpenAlex | Primary source engagement, interpretive framework awareness |
| **Natural Sciences** | physics, chemistry, biology, genetics… | arXiv, Semantic Scholar | Experimental design, measurement precision, replication status |

Domain detection is automatic based on keyword density in the transcript. Force a domain with `--domain computer-science`.

### 🔄 Deep Iterative Research

`--research-depth deep` enables multi-pass research:

1. **Initial search** — standard literature retrieval
2. **Gap analysis** — identify low-confidence claims and literature gaps
3. **Targeted re-search** — new queries for gaps
4. **Re-verification** — expanded evidence synthesis with all sources
5. **Convergence** — stops when no new sources are found or max iterations reached

### 📊 Multi-Source Synthesis

With `--synthesis` and 2+ videos in `links.txt`, the system generates a cross-source synthesis report identifying:

- **Consensus themes** — where sources agree
- **Contradictions** — where sources disagree
- **Literature gaps** — important topics no source covers
- **Unique contributions** — what each source adds

### 🖼️ Visual Content Analysis

With `--vision`, keyframes are extracted from the video and analyzed by vision-capable AI:

- **Equations** — reproduced in LaTeX where possible
- **Diagrams** — described structurally
- **Code** — language and key operations identified
- **Charts and tables** — data extracted and contextualized
- **On-screen citations** — transcribed exactly

Requires a vision-capable model (GPT-5.5, Claude, Gemini). Automatically skipped for providers without vision support.

### 🏗️ Provider-Agnostic Architecture

All four AI providers are supported with feature parity where the provider allows:

| Feature | OpenAI | Anthropic | Google | OpenAI-compat |
|---|---|---|---|---|
| Report generation | ✅ GPT-5.5 | ✅ Claude | ✅ Gemini | ✅ Groq, DeepSeek, Ollama |
| Transcription | ✅ Whisper | ❌ (needs OpenAI key) | ❌ (needs OpenAI key) | ✅ (if supported) |
| Reasoning/thinking | ✅ `reasoning.effort` | ✅ `thinking.budget_tokens` | ✅ `thinkingConfig` | ✅ System prompt guidance |
| Structured output | ✅ `json_schema` strict | ✅ Tool use + `tool_choice` | ✅ `response_schema` | ✅ `json_schema` / `json_object` fallback |
| Vision (Phase 5) | ✅ `image_url` base64 | ✅ `image` content blocks | 🚧 Planned | ❌ (env override available) |
| Zero new dependencies | ✅ `openai` SDK only | ✅ `fetch()` only | ✅ `fetch()` only | ✅ `openai` SDK only |

---

## Complete CLI Reference

### Core Options

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--links FILE` | — | `./links.txt` | File with video URLs, one per line (any yt-dlp supported site) |
| `--out-dir DIR` | — | `./outputs` | Output root directory |
| `--run-name NAME` | — | `run-YYYY-MM-DD-HHMMSS` | Custom run folder name |
| `--ai-provider ID` | `AI_PROVIDER` | `openai` | `openai`, `anthropic`, `google`, `openai-compat` |
| `--transcription-model ID` | `OPENAI_TRANSCRIPTION_MODEL` | `whisper-1` | Transcription model |
| `--report-model ID` | — | Provider default | Report generation model |
| `--reasoning-effort LEVEL` | `OPENAI_REASONING_EFFORT` | `medium` | `low`, `medium`, `high` |
| `--verbosity LEVEL` | `OPENAI_TEXT_VERBOSITY` | `medium` | `low`, `medium`, `high` |
| `--max-output-tokens N` | — | Provider default | Report output token budget |
| `--transcript FILE` | — | — | Generate report from existing transcript |
| `--title TEXT` | — | — | Report title (with `--transcript`) |
| `--skip-download` | — | — | Treat links as local video paths |
| `--no-report` | — | — | Download and transcribe only |

### Research Options

| Flag | Env Var | Default | Description |
|---|---|---|---|
| `--research` | `RESEARCH_ENABLED` | off | Enable literature search + citations |
| `--research-depth LEVEL` | `RESEARCH_DEPTH` | `medium` | `none`, `light`, `medium`, `deep` |
| `--research-topics "a; b"` | `RESEARCH_TOPICS` | auto | Semicolon-separated topics |
| `--max-sources N` | `RESEARCH_MAX_SOURCES` | 10 | Sources to cite in report |
| `--max-papers-per-topic N` | `RESEARCH_MAX_PAPERS_PER_TOPIC` | 5 | Papers per query per source |
| `--research-apis LIST` | `RESEARCH_APIS` | all four | `arxiv,semantic_scholar,crossref,openalex` |
| `--citation-style STYLE` | `CITATION_STYLE` | `apa` | `apa`, `chicago`, `ieee` |
| `--verify` | `VERIFY_ENABLED` | off | Evidence synthesis + claim verification |
| `--domain ID` | `DOMAIN` | auto | Force domain profile |
| `--synthesis` | `SYNTHESIS` | off | Cross-source synthesis (2+ videos) |
| `--vision` | `VISION_ENABLED` | off | Visual frame analysis |
| `--max-frames N` | `MAX_FRAMES` | 20 | Max frames to extract |
| `--research-iterations N` | `RESEARCH_ITERATIONS` | 3 | Max deep research iterations |

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `AI_PROVIDER` | No (default: `openai`) | `openai`, `anthropic`, `google`, `openai-compat` |
| `OPENAI_API_KEY` | For OpenAI / transcription | OpenAI API key |
| `OPENAI_BASE_URL` | For openai-compat | Compatible endpoint URL |
| `ANTHROPIC_API_KEY` | For Anthropic | Anthropic API key |
| `GOOGLE_API_KEY` | For Google | Google Gemini API key |
| `SEMANTIC_SCHOLAR_API_KEY` | No (optional) | Raises rate limit from 100 to 1000 req/5min |
| `RESEARCH_MAILTO` | No (recommended) | CrossRef polite pool identification |
| `CITATION_STYLE` | No (default: `apa`) | Citation formatting style |

---

## Examples

### Basic: Study Guide from a Lecture

```bash
npm run research
```

Generates a polished standalone article with executive summary, key ideas, glossary, study questions, and a 7-day study plan.

### Research: Cited Report with Peer-Reviewed Sources

```bash
npm run research -- --research --citation-style apa --max-sources 10
```

Searches arXiv, Semantic Scholar, CrossRef, and OpenAlex for relevant papers, injects 10 best sources, and generates a cited report with APA-formatted reference list.

### Deep: PhD-Grade Research with Evidence Verification

```bash
npm run research -- \
  --research \
  --research-depth deep \
  --verify \
  --citation-style apa \
  --max-sources 20 \
  --reasoning-effort high \
  --verbosity high \
  --max-output-tokens 32000
```

Multi-pass iterative research with evidence synthesis, confidence levels per claim, and maximum academic rigor.

### Multi-Source: Synthesize Across Multiple Videos

```bash
# links.txt contains 2+ related videos
npm run research -- --research --verify --synthesis
```

Generates individual cited reports plus a cross-source synthesis identifying consensus, disagreements, and gaps.

### Visual: Analyze Slides, Code, and Equations

```bash
npm run research -- --research --vision --max-frames 30
```

Extracts keyframes from the video, analyzes visual content (equations, diagrams, code, charts), and integrates findings into the report.

### Resume: Report from Saved Transcript

```bash
npm run research -- \
  --transcript "outputs/run-2026-08-04-065333/transcripts/my-video.timestamped.md" \
  --title "My Research Topic" \
  --research --verify
```

Reuses an existing transcript without re-downloading or re-transcribing.

### Provider-Specific

```bash
# Anthropic Claude with high thinking budget
npm run research -- --ai-provider anthropic --report-model claude-opus-5 --reasoning-effort high

# Google Gemini
npm run research -- --ai-provider google --report-model gemini-2.5-pro

# Groq (fast Llama)
npm run research -- --ai-provider openai-compat --report-model llama-3.3-70b-versatile
```

---

## Output Structure

```
outputs/run-YYYY-MM-DD-HHMMSS/
├── links.txt                          # Copy of input links
├── manifest.json                      # Full run metadata
├── downloads/
│   └── Video Title [videoId].mp4      # Downloaded video + .info.json
├── transcripts/
│   ├── video-slug.transcript.json     # Whisper verbose_json (word timestamps)
│   ├── video-slug.transcript.txt      # Plain text
│   └── video-slug.timestamped.md      # Timestamped markdown
├── reports/
│   ├── video-slug.research.json       # Structured research data
│   └── video-slug.research.md         # Polished standalone article
├── research/                          # (--research enabled)
│   ├── search-queries.jsonl           # Every search query logged
│   └── sources.json                   # Retrieved + selected sources
├── frames/                            # (--vision enabled)
│   └── video-slug/
│       ├── frame-001.jpg
│       └── frame-002.jpg
└── synthesis/                         # (--synthesis enabled)
    ├── synthesis.json
    └── synthesis.md
```

---

## Architecture

```
scripts/
├── process-links.mjs          # Pipeline conductor
├── ai-config.mjs              # Configuration resolution (env + CLI)
├── doctor.mjs                 # Environment validation
├── lib.mjs                    # Utilities (slugify, timestamp, args parser)
├── prompts/
│   └── index.mjs              # All LLM schemas and prompt builders
├── domains/
│   └── index.mjs              # 5 domain profiles with auto-detection
├── providers/
│   ├── interface.mjs          # Provider factory + retry logic
│   ├── openai.mjs             # OpenAI (Responses API + vision)
│   ├── anthropic.mjs          # Anthropic (Messages API + thinking + vision)
│   ├── google.mjs             # Google (Gemini API)
│   └── openai-compat.mjs      # OpenAI-compatible (Groq, DeepSeek, Ollama)
└── research/
    ├── index.mjs              # Research orchestrator
    ├── citation-manager.mjs   # Reference tracking + formatting
    ├── literature-search.mjs  # 4 academic API adapters
    ├── evidence-synthesis.mjs # Claim verification engine
    ├── iterative-research.mjs # Deep multi-pass research
    ├── synthesis.mjs          # Cross-source synthesis
    ├── vision-analysis.mjs    # Frame extraction + vision AI
    └── provenance.mjs         # JSONL audit logging
```

**Design principles:**
- **Zero new npm dependencies** — everything uses Node.js built-in `fetch()` and the existing `openai` SDK
- **All external APIs are free** — arXiv, Semantic Scholar, CrossRef, OpenAlex require no payment
- **Provider-agnostic** — every LLM feature degrades gracefully when unsupported
- **Strictly additive** — default behavior is byte-compatible with the original tool
- **Graceful degradation** — any optional feature failing does not crash the pipeline

---

## Cost Estimates

| Mode | Transcription | LLM Passes | Research APIs | Approximate Cost (OpenAI) |
|---|---|---|---|---|
| Basic (no flags) | 1× Whisper | 1× GPT-5.5 | None | ~$0.10–0.30/video |
| Research (`--research`) | 1× Whisper | 2× GPT-5.5 (query plan + report) | 15–30 free API calls | ~$0.20–0.60/video |
| Research + Verify (`--research --verify`) | 1× Whisper | 3× GPT-5.5 | 15–30 free API calls | ~$0.30–0.90/video |
| Deep (`--research-depth deep`) | 1× Whisper | 5–8× GPT-5.5 | 50–100 free API calls | ~$0.50–2.00/video |

All academic database queries are **free**. Costs only come from LLM API calls.

---

## FAQ

**Does this replace peer review?** No. The system retrieves and cites peer-reviewed sources, but it does not perform peer review itself. It's a research *assistant*, not a replacement for expert judgment.

**How accurate are the citations?** Citations are validated against fetched metadata (DOI, title, authors). The system prunes hallucinated citations that don't match any retrieved source. However, the LLM may still miscorrelate a claim with a source — the evidence synthesis pass helps catch this.

**What if an academic API is down?** The pipeline continues without that source. Failures are logged to the audit trail and reported in the console.

**What video sources are supported?** Any of the 1,750+ sites that [yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) supports — YouTube, Vimeo, Twitch, TikTok, Twitter/X, Facebook, Instagram, Dailymotion, Bilibili, Coursera, edX, academic lecture platforms, podcasts, and more. The pipeline auto-detects the source and applies the right download strategy. With `--skip-download`, any local video file works regardless of origin.

**What languages does transcription support?** Whisper supports 99 languages. Transcription quality varies by language.

**Is my data private?** All processing is local except for API calls (transcription to OpenAI, report generation to your chosen AI provider, literature search to public academic databases). No data is stored on external servers beyond what those APIs normally log.

---

## Contributing

Contributions welcome. Areas of interest:

- Additional academic database adapters (PubMed, Scopus, Web of Science)
- Additional domain profiles
- Export formats (LaTeX, docx, PDF)
- Web UI / Electron app
- Docker containerization
- Additional citation styles (MLA, Harvard, Vancouver)
- Full-text retrieval and analysis (beyond metadata)

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">
  <b>YouTube Research AI</b> — From passive watching to active research.<br>
  Built with ❤️ for lifelong learners, researchers, and the insatiably curious.
</p>
