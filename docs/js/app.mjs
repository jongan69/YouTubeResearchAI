// YTResearchAI Web App — vanilla JS SPA
// Connects to the Express API server via fetch + SSE.

const API = (() => {
  const base = window.__API_URL__ || `${location.protocol}//${location.hostname}:3000`;

  return {
    async submitJob({url, options, apiKey}) {
      const r = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-API-Key': apiKey || ''},
        body: JSON.stringify({url, options}),
      });
      return r.json();
    },

    async getJob(id) {
      const r = await fetch(`${base}/api/jobs/${id}`);
      return r.json();
    },

    streamJob(id, onProgress, onComplete, onError) {
      const es = new EventSource(`${base}/api/jobs/${id}/stream`);
      es.addEventListener('progress', (e) => {
        try { onProgress(JSON.parse(e.data)); } catch {}
      });
      es.addEventListener('complete', (e) => {
        try { onComplete(JSON.parse(e.data)); } catch {}
        es.close();
      });
      es.addEventListener('error', (e) => {
        try { const d = JSON.parse(e.data); onError(d); } catch { onError({message: 'Connection lost'}); }
        es.close();
      });
      es.onerror = () => { onError({message: 'SSE connection failed'}); es.close(); };
      return es;
    },

    async getReport(id) {
      const r = await fetch(`${base}/api/jobs/${id}/report`);
      return r.json();
    },

    async validateKey(apiKey) {
      const r = await fetch(`${base}/api/validate-key`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({apiKey}),
      });
      return r.json();
    },

    async getRecentJobs() {
      try {
        const r = await fetch(`${base}/api/jobs`);
        return r.json();
      } catch { return []; }
    },
  };
})();

// ---- State ----------------------------------------------------------------

const state = {
  apiKey: localStorage.getItem('ytresearch_api_key') || '',
  currentJobId: null,
  eventSource: null,
};

// ---- DOM refs -------------------------------------------------------------

const $ = (s) => document.querySelector(s);
const show = (el) => { el.style.display = ''; };
const hide = (el) => { el.style.display = 'none'; };

// ---- Markdown rendering (lightweight) --------------------------------------

const renderMarkdown = (md) => {
  // Simple but effective markdown → HTML converter
  let html = md
    // Headings
    .replace(/^#### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Wrap consecutive <li> in <ul> or <ol>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Paragraphs: wrap lines that aren't already HTML tags
  const lines = html.split('\n');
  const out = [];
  let inCodeBlock = false, codeBlock = '', codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        out.push(`<pre><code class="language-${codeLang}">${codeBlock.trim()}</code></pre>`);
        codeBlock = ''; codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) { codeBlock += line + '\n'; continue; }

    // Skip lines that are already HTML tags or empty
    if (/^<\/?[a-z]/.test(line.trim()) || line.trim() === '') {
      out.push(line);
    } else {
      out.push(`<p>${line}</p>`);
    }
  }
  if (inCodeBlock) out.push(`<pre><code>${codeBlock.trim()}</code></pre>`);

  return out.join('\n');
};

// ---- App logic ------------------------------------------------------------

const init = async () => {
  const apiInput = $('#api-key-input');
  const urlInput = $('#url-input');
  const submitBtn = $('#submit-btn');
  const optionsToggle = $('#options-toggle');
  const optionsRow = $('#options-row');
  const keyHint = $('#key-hint');

  // Restore saved API key
  if (state.apiKey) {
    apiInput.value = state.apiKey;
    keyHint.textContent = '🔑 Saved key';
  }

  // Validate key on input
  let keyTimeout;
  apiInput.addEventListener('input', () => {
    clearTimeout(keyTimeout);
    keyTimeout = setTimeout(async () => {
      const key = apiInput.value.trim();
      if (!key || key.length < 10) { keyHint.textContent = ''; return; }
      if (key === state.apiKey) { keyHint.textContent = '🔑 Saved key'; return; }
      keyHint.textContent = '⏳ Validating...';
      const v = await API.validateKey(key);
      if (v.valid) {
        state.apiKey = key;
        localStorage.setItem('ytresearch_api_key', key);
        keyHint.textContent = `✅ Valid (${v.provider})`;
      } else {
        keyHint.textContent = '❌ Invalid key';
      }
    }, 800);
  });

  // Options toggle
  optionsToggle.addEventListener('click', () => {
    const hidden = optionsRow.style.display === 'none';
    optionsRow.style.display = hidden ? '' : 'none';
    optionsToggle.textContent = hidden ? '⚙️ Hide Options' : '⚙️ Options';
  });

  // Submit
  const doSubmit = async () => {
    const url = urlInput.value.trim();
    if (!url) return;

    const options = {
      research: $('#opt-research').checked,
      verify: $('#opt-verify').checked,
      vision: $('#opt-vision').checked,
      'citation-style': $('#opt-style').value,
      'reasoning-effort': 'medium',
      verbosity: 'medium',
    };

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting...';
    hide($('#report-section'));
    hide($('#error-section'));
    show($('#progress-section'));
    $('#progress-stage').textContent = 'Submitting...';
    $('#progress-pct').textContent = '0%';
    $('#progress-bar').style.width = '0%';
    $('#progress-msg').textContent = 'Sending job to server...';

    try {
      const key = state.apiKey || undefined;
      const r = await API.submitJob({url, options, apiKey: key});

      if (r.error) {
        if (r.freeTierRemaining !== undefined) {
          $('#form-status').textContent = `Free tier limit reached. Add your API key above (${r.freeTierRemaining} free reports remaining today).`;
        } else {
          showError(r.error);
        }
        submitBtn.disabled = false;
        submitBtn.textContent = 'Generate Report';
        hide($('#progress-section'));
        return;
      }

      state.currentJobId = r.jobId;
      $('#form-status').textContent = '';
      streamProgress(r.jobId);
    } catch (err) {
      showError(err.message || 'Failed to submit job');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Generate Report';
      hide($('#progress-section'));
    }
  };

  submitBtn.addEventListener('click', doSubmit);
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });

  // Load recent jobs
  loadRecentJobs();

  // New report button
  $('#new-report-btn').addEventListener('click', resetForm);
  $('#retry-btn').addEventListener('click', resetForm);
};

const streamProgress = (jobId) => {
  if (state.eventSource) state.eventSource.close();

  state.eventSource = API.streamJob(jobId,
    (data) => {
      $('#progress-stage').textContent = data.stage || data.message || 'Processing...';
      $('#progress-pct').textContent = `${data.progress || 0}%`;
      $('#progress-bar').style.width = `${data.progress || 0}%`;
      if (data.message) $('#progress-msg').textContent = data.message;
    },
    (data) => {
      hide($('#progress-section'));
      $('#submit-btn').disabled = false;
      $('#submit-btn').textContent = 'Generate Report';
      showReport(data.result);
    },
    (data) => {
      showError(data.message || 'Job failed');
      $('#submit-btn').disabled = false;
      $('#submit-btn').textContent = 'Generate Report';
      hide($('#progress-section'));
    },
  );
};

const showReport = (result) => {
  show($('#report-section'));
  const meta = $('#report-meta');
  const refCount = result.references?.length || 0;
  const domain = result.methodology?.domain || 'General';
  meta.innerHTML = `<strong>${result.title || 'Research Report'}</strong> · ${refCount} sources · Domain: ${domain}`;

  const content = $('#report-content');
  content.innerHTML = renderMarkdown(result.reportMarkdown || '');

  // Scroll to report
  $('#report-section').scrollIntoView({behavior: 'smooth'});

  // Download buttons
  $('#download-md').onclick = () => downloadFile(`${slugify(result.title || 'report')}.md`, result.reportMarkdown || '', 'text/markdown');
  $('#download-json').onclick = () => downloadFile(`${slugify(result.title || 'report')}.json`, JSON.stringify(result, null, 2), 'application/json');
  $('#copy-link').onclick = () => {
    navigator.clipboard.writeText(`${location.origin}${location.pathname}?job=${state.currentJobId}`);
    $('#copy-link').textContent = '✅ Copied!';
    setTimeout(() => $('#copy-link').textContent = '🔗 Copy Link', 2000);
  };

  loadRecentJobs();
};

const showError = (msg) => {
  hide($('#progress-section'));
  show($('#error-section'));
  $('#error-msg').textContent = msg;
};

const resetForm = () => {
  hide($('#report-section'));
  hide($('#error-section'));
  hide($('#progress-section'));
  $('#url-input').value = '';
  $('#submit-btn').disabled = false;
  $('#submit-btn').textContent = 'Generate Report';
  $('#form-status').textContent = '';
  $('#url-input').focus();
  if (state.eventSource) { state.eventSource.close(); state.eventSource = null; }
  loadRecentJobs();
};

const loadRecentJobs = async () => {
  const jobs = await API.getRecentJobs();
  if (!jobs.length) return;
  show($('#recent-section'));
  const list = $('#recent-list');
  list.innerHTML = jobs.slice(0, 10).map(j => `
    <div class="recent-item">
      <div style="display:flex;align-items:center;overflow:hidden;">
        <span class="status-dot ${j.status === 'complete' ? 'status-complete' : j.status === 'failed' ? 'status-failed' : 'status-running'}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${j.url?.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</span>
      </div>
      <span style="color:var(--muted);flex-shrink:0;margin-left:8px;font-size:.75rem;">
        ${j.status === 'complete' ? '✅ ' + (j.result?.references?.length || 0) + ' refs' : j.status === 'failed' ? '❌ Failed' : '⏳ ' + (j.stage || 'queued')}
      </span>
    </div>
  `).join('');
};

const downloadFile = (filename, content, mime) => {
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
};

const slugify = (s) => (s || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// Boot
init();
