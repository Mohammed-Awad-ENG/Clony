import { getCloneDetails } from '../utils/api.js';
import { socket } from '../utils/socket.js';
import { t } from '../i18n.js';

export default class ProgressView {
  constructor(params) {
    this.cloneId = params.id;
    this.maxPages = 0;
  }

  async render() {
    this.container = document.createElement('div');
    this.container.className = 'progress-view';
    this.container.style.padding = '2rem 0';
    
    this.container.innerHTML = `
      <div class="card" style="margin-bottom: 2rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <h2 id="prog-domain" style="margin: 0;">Loading...</h2>
          <span id="prog-status" class="status-badge" style="padding: 0.25rem 0.75rem; border-radius: 99px; background: var(--bg-hover);">Loading</span>
        </div>
        
        <div style="margin-bottom: 2rem;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 0.875rem;">
            <span><span id="prog-count">0</span> / <span id="prog-total">0</span> Pages</span>
            <span id="prog-percent">0%</span>
          </div>
          <div class="progress-bar">
            <div id="prog-fill" class="progress-fill" style="width: 0%"></div>
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
          <div style="background: var(--bg-deep); padding: 1rem; border-radius: 8px;">
            <div style="color: var(--text-secondary); font-size: 0.875rem;" data-i18n="prog_pages_found">${t('prog_pages_found')}</div>
            <div id="stat-found" style="font-size: 1.5rem; font-weight: 600;">0</div>
          </div>
          <div style="background: var(--bg-deep); padding: 1rem; border-radius: 8px;">
            <div style="color: var(--text-secondary); font-size: 0.875rem;" data-i18n="prog_downloaded">${t('prog_downloaded')}</div>
            <div id="stat-downloaded" style="font-size: 1.5rem; font-weight: 600;">0</div>
          </div>
          <div style="background: var(--bg-deep); padding: 1rem; border-radius: 8px;">
            <div style="color: var(--text-secondary); font-size: 0.875rem;" data-i18n="prog_assets">${t('prog_assets')}</div>
            <div id="stat-assets" style="font-size: 1.5rem; font-weight: 600;">0</div>
          </div>
          <div style="background: var(--bg-deep); padding: 1rem; border-radius: 8px;">
            <div style="color: var(--text-secondary); font-size: 0.875rem;" data-i18n="prog_size">${t('prog_size')}</div>
            <div id="stat-size" style="font-size: 1.5rem; font-weight: 600;">0 MB</div>
          </div>
        </div>
        
        <div id="action-buttons" style="display: flex; gap: 1rem;">
          <a href="#/library" class="btn btn-secondary">Back to Library</a>
        </div>
      </div>
      
      <div class="card">
        <h3 style="margin-bottom: 1rem;">Live Log</h3>
        <div id="live-log" class="mono" style="background: var(--bg-deep); padding: 1rem; border-radius: 4px; height: 300px; overflow-y: auto; font-size: 0.875rem; color: var(--text-secondary);">
        </div>
      </div>
    `;
    
    this.handleProgress = this.handleProgress.bind(this);
    this.handleStatus = this.handleStatus.bind(this);
    this.handleStop = this.handleStop.bind(this);

    await this.loadDetails();
    
    socket.on('crawl-progress', this.handleProgress);
    socket.on('clone-status', this.handleStatus);
    
    return this.container;
  }
  
  unmount() {
    socket.off('crawl-progress', this.handleProgress);
    socket.off('clone-status', this.handleStatus);
    
    const stopBtn = this.container.querySelector('#btn-stop');
    if (stopBtn) stopBtn.removeEventListener('click', this.handleStop);
  }

  async handleStop(e) {
    if (e) e.preventDefault();
    const btn = this.container.querySelector('#btn-stop');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Stopping...';
    }
    try {
      await fetch(`/api/clones/${this.cloneId}/stop`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to send stop request', err);
    }
  }

  async loadDetails() {
    try {
      const data = await getCloneDetails(this.cloneId);
      const { clone, pages, assets } = data;
      
      this.maxPages = JSON.parse(clone.options || '{}').maxPages || 500;
      
      this.container.querySelector('#prog-domain').textContent = clone.domain;
      this.updateStatus(clone.status);
      this.updateStats(clone.pages_found, clone.pages_downloaded, clone.assets_downloaded, clone.total_size_bytes);
      
      // Fetch historical logs
      try {
        const res = await fetch(`/api/clones/${this.cloneId}/logs`);
        if (res.ok) {
          const logs = await res.json();
          const logContainer = this.container.querySelector('#live-log');
          if (logContainer) logContainer.innerHTML = '';
          logs.forEach(log => this.appendLogEntry(log));
        }
      } catch(e) {
        console.error("Failed to load historical logs", e);
      }
      
    } catch (e) {
      this.container.innerHTML = `<div class="error">Failed to load clone details</div>`;
    }
  }
  
  updateStatus(status) {
    const el = this.container.querySelector('#prog-status');
    if (el) {
      el.textContent = t(`lib_status_${status}`) || status;
      el.className = `status-badge ${status}`;
    }
    
    const actions = this.container.querySelector('#action-buttons');
    if (actions) {
      if (status === 'completed') {
        actions.innerHTML = `
          <a href="#/preview/${this.cloneId}" class="btn btn-primary" data-i18n="btn_preview">${t('btn_preview')}</a>
          <a href="#/library" class="btn btn-secondary">Back to Library</a>
        `;
      } else if (status === 'crawling' || status === 'pending') {
        actions.innerHTML = `
          <button id="btn-stop" class="btn btn-danger">Stop Crawl</button>
          <a href="#/library" class="btn btn-secondary">Back to Library</a>
        `;
        const stopBtn = actions.querySelector('#btn-stop');
        if (stopBtn) stopBtn.addEventListener('click', this.handleStop);
      } else {
        actions.innerHTML = `
          <a href="#/library" class="btn btn-secondary">Back to Library</a>
        `;
      }
    }
  }
  
  updateStats(found, downloaded, assets, sizeBytes) {
    this.container.querySelector('#stat-found').textContent = found;
    this.container.querySelector('#stat-downloaded').textContent = downloaded;
    this.container.querySelector('#prog-count').textContent = downloaded;
    this.container.querySelector('#prog-total').textContent = this.maxPages;
    if (assets !== undefined) {
      this.container.querySelector('#stat-assets').textContent = assets;
    }
    if (sizeBytes !== undefined) {
      this.container.querySelector('#stat-size').textContent = (sizeBytes / 1024 / 1024).toFixed(2) + ' MB';
    }
    
    const percent = Math.min(100, Math.round((downloaded / this.maxPages) * 100));
    this.container.querySelector('#prog-percent').textContent = `${percent}%`;
    this.container.querySelector('#prog-fill').style.width = `${percent}%`;
  }

  appendLogEntry(data) {
    const log = this.container.querySelector('#live-log');
    if (!log) return;
    
    const entry = document.createElement('div');
    entry.style.marginBottom = '0.25rem';
    
    let color = 'var(--text-secondary)';
    if (data.status === 'success') color = 'var(--accent-primary)';
    if (data.status === 'failed') color = 'var(--accent-danger)';
    
    const percentStr = data.percentage !== undefined ? String(data.percentage).padStart(3, ' ') : '  0';
    entry.innerHTML = `<span style="color: ${color}">[${percentStr}%] [${data.status.toUpperCase()}]</span> ${data.url}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    
    // Keep only last 1000 lines to avoid DOM bloat on huge sites
    if (log.children.length > 1000) {
      log.removeChild(log.firstChild);
    }
  }

  handleProgress(data) {
    if (data.cloneId !== this.cloneId) return;
    
    this.appendLogEntry(data);
    
    // Refresh stats from DB occasionally to keep them accurate, 
    // or we can just increment locally for smoothness
    if (data.status === 'success') {
      const downloadedEl = this.container.querySelector('#stat-downloaded');
      if (downloadedEl) {
        const current = parseInt(downloadedEl.textContent, 10);
        this.updateStats(
          parseInt(this.container.querySelector('#stat-found').textContent, 10),
          current + 1,
          undefined,
          undefined
        );
      }
    }
  }

  handleStatus(data) {
    if (data.id !== this.cloneId) return;
    this.updateStatus(data.status);
    if (data.status === 'completed' || data.status === 'failed') {
      this.loadDetails(); // Final full sync
    }
  }
}
