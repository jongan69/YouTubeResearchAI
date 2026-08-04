// Progress emitter — normalizes pipeline events for both CLI and web consumers.
import {EventEmitter} from 'node:events';

export class ProgressEmitter extends EventEmitter {
  /** Emit a progress event with stage info and optional data. */
  emitProgress(stage, progress, message, data = {}) {
    this.emit('progress', {stage, progress, message, ts: Date.now(), ...data});
  }

  /** Emit a completion event with the final result. */
  emitComplete(result) {
    this.emit('complete', result);
  }

  /** Emit an error event. */
  emitError(error) {
    this.emit('error', {message: error.message ?? String(error), stage: error.stage ?? 'unknown'});
  }

  /** Create a bound onProgress callback for use with the pipeline modules. */
  onProgress() {
    return (stage, progress, message, data) => this.emitProgress(stage, progress, message, data);
  }

  /** Pipe progress events to console (for CLI backward compatibility). */
  pipeToConsole() {
    this.on('progress', ({stage, progress, message}) => {
      const pct = progress != null ? ` ${progress}%` : '';
      console.log(`  [${stage}]${pct} ${message}`);
    });
    return this;
  }
}
