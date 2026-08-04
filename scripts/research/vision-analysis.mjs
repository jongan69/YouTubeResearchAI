// ---------------------------------------------------------------------------
// VisionAnalyzer — extract and analyze keyframes from video.
//
// Phase 5: Extracts frames at scene changes or regular intervals, then uses
// vision-capable AI to describe slides, equations, diagrams, code, and charts.
// ---------------------------------------------------------------------------

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FRAME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    visualNotes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          timestamp: {type: 'string'},
          kind: {type: 'string', enum: ['equation', 'diagram', 'code', 'chart', 'table', 'slide', 'screenshot', 'other']},
          description: {type: 'string'},
          relevance: {type: 'string'},
          transcriptConnection: {type: 'string'},
        },
        required: ['timestamp', 'kind', 'description', 'relevance', 'transcriptConnection'],
      },
    },
  },
  required: ['visualNotes'],
};

export class VisionAnalyzer {
  /**
   * @param {object} opts
   * @param {object} opts.ai       — AI provider (must support vision/image inputs)
   */
  constructor({ai}) {
    this._ai = ai;
  }

  /**
   * Extract keyframes from a video at regular intervals.
   *
   * @param {object} opts
   * @param {string} opts.videoPath     — path to video file
   * @param {string} opts.outputDir     — directory to write frames
   * @param {number} [opts.intervalSec] — extract one frame every N seconds (default: 90)
   * @param {number} [opts.maxFrames]   — cap on total frames (default: 20)
   * @returns {string[]} paths to extracted frame JPEGs
   */
  extractKeyframes({videoPath, outputDir, intervalSec = 90, maxFrames = 20}) {
    fs.mkdirSync(outputDir, {recursive: true});

    // Probe duration
    let durationSec = 0;
    try {
      const out = execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', videoPath,
      ], {encoding: 'utf8'});
      durationSec = Number(out.trim()) || 0;
    } catch {
      durationSec = 0;
    }

    if (durationSec === 0) {
      console.warn('  Could not probe video duration — skipping frame extraction.');
      return [];
    }

    // Calculate frame count
    const frameCount = Math.min(maxFrames, Math.floor(durationSec / intervalSec));
    if (frameCount === 0) return [];

    console.log(`  Extracting ${frameCount} keyframes (video: ${Math.round(durationSec)}s, interval: ${intervalSec}s)...`);

    const framePaths = [];
    for (let i = 0; i < frameCount; i++) {
      const seekTime = Math.min(i * intervalSec, durationSec - 1);
      const framePath = path.join(outputDir, `frame-${String(i + 1).padStart(3, '0')}.jpg`);
      try {
        execFileSync('ffmpeg', [
          '-hide_banner', '-loglevel', 'error', '-y',
          '-ss', String(seekTime),
          '-i', videoPath,
          '-vframes', '1',
          '-q:v', '3',
          '-vf', 'scale=1024:-1',  // Max 1024px wide, maintain aspect ratio
          framePath,
        ], {stdio: 'inherit'});
        framePaths.push(framePath);
      } catch {
        console.warn(`  Failed to extract frame at ${seekTime}s.`);
      }
    }

    return framePaths;
  }

  /**
   * Analyze extracted frames using vision AI.
   *
   * NOTE: This method uses a provider-specific approach. For OpenAI, we use
   * base64-encoded images in a chat.completions call. For Anthropic, we use
   * image content blocks. The orchestrator detects capabilities.
   *
   * @param {object} opts
   * @param {string[]} opts.framePaths    — paths to JPEG frames
   * @param {string}   [opts.transcriptContext] — nearby transcript for context
   * @returns {Promise<object>} {visualNotes: [...]}
   */
  async analyzeFrames({framePaths, transcriptContext = ''}) {
    if (!framePaths || framePaths.length === 0) {
      return {visualNotes: []};
    }

    if (!this._ai.analyzeImages) {
      console.warn('  Vision analysis: provider does not support image analysis. Skipping.');
      return {visualNotes: []};
    }

    console.log(`  Analyzing ${framePaths.length} frames with vision AI...`);

    try {
      const result = await this._ai.analyzeImages({
        imagePaths: framePaths,
        prompt: [
          'Analyze these frames from an educational video.',
          'For each frame, describe:',
          '- What kind of visual content it is (equation, diagram, code, chart, table, slide, screenshot, other)',
          '- A detailed description of what is shown',
          '- Why it is relevant to the video\'s topic',
          '- How it connects to the spoken content (if provided below)',
          '',
          'If there are citations, references, or DOIs visible on screen, transcribe them exactly.',
          'If there are equations, reproduce them in LaTeX where possible.',
          'If there is code, note the language and key operations.',
          '',
          transcriptContext ? `Transcript context:\n${transcriptContext.slice(0, 1000)}` : '',
        ].join('\n'),
        jsonSchema: FRAME_SCHEMA,
        schemaName: 'visual_frame_analysis',
        maxOutputTokens: 6000,
      });
      return result;
    } catch (err) {
      console.warn(`  Vision analysis failed: ${err.message}`);
      return {visualNotes: []};
    }
  }

  /**
   * Clean up extracted frame files.
   */
  static cleanupFrames(framePaths) {
    for (const p of framePaths) {
      try { fs.rmSync(p, {force: true}); } catch { /* ignore */ }
    }
  }
}
