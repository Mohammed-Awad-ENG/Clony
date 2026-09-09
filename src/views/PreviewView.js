import { getCloneDetails } from '../utils/api.js';
import { t } from '../i18n.js';

export default class PreviewView {
  constructor(params) {
    this.cloneId = params.id;
  }

  async render() {
    this.container = document.createElement('div');
    this.container.className = 'preview-view';
    this.container.style.cssText = `
      display: flex;
      flex-direction: column;
      height: calc(100vh - 150px);
    `;
    
    this.container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <div>
          <h2 id="prev-domain" style="margin: 0;">Loading...</h2>
          <div style="font-size: 0.875rem; color: var(--text-secondary);">
            <span id="prev-pages">0</span> Pages • <span id="prev-size">0</span> MB
          </div>
        </div>
        <div style="display: flex; gap: 1rem;">
          <a href="#/library" class="btn btn-secondary">Back</a>
          <button id="btn-export" class="btn btn-primary" data-i18n="btn_export">${t('btn_export')}</button>
        </div>
      </div>
      
      <div style="display: flex; gap: 1.5rem; flex: 1; overflow: hidden;">
        <!-- Sidebar: Sitemap Tree -->
        <div class="card" style="width: 300px; overflow-y: auto; padding: 1rem;">
          <h3 style="margin-bottom: 1rem; font-size: 1rem;">Sitemap</h3>
          <ul id="sitemap-tree" style="list-style: none; margin: 0; padding: 0; font-size: 0.875rem;">
            <li>Loading...</li>
          </ul>
        </div>
        
        <!-- Main: Iframe Preview -->
        <div id="iframe-container" class="card" style="flex: 1; padding: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--bg-surface);">
          <div style="background: var(--bg-deep); padding: 0.5rem 1rem; border-bottom: 1px solid var(--border); display: flex; gap: 0.5rem; align-items: center;">
            <div style="display: flex; gap: 0.3rem;">
              <div style="width: 12px; height: 12px; border-radius: 50%; background: #ef4444;"></div>
              <div style="width: 12px; height: 12px; border-radius: 50%; background: #f59e0b;"></div>
              <div style="width: 12px; height: 12px; border-radius: 50%; background: #10b981;"></div>
            </div>
            <input type="text" id="address-bar" readonly class="mono" style="flex: 1; background: var(--bg-surface); border: none; border-radius: 4px; padding: 0.25rem 0.5rem; color: var(--text-secondary); font-size: 0.75rem;" value="about:blank">
            <button id="btn-maximize" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0.25rem;" title="Maximize Preview">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
              </svg>
            </button>
          </div>
          <iframe id="preview-frame" style="width: 100%; height: 100%; border: none; background: #fff;" sandbox="allow-same-origin allow-scripts allow-popups allow-forms"></iframe>
        </div>
      </div>
      
      <!-- Export Modal -->
      <div id="export-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center; backdrop-filter: blur(5px);">
        <div class="card" style="width: 100%; max-width: 750px; position: relative; border-color: var(--border); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
          
          <!-- Loading Overlay inside the card -->
          <div id="export-overlay" class="export-overlay">
            <div class="spinner"></div>
            <h3 style="margin-bottom: 0;" data-i18n="export_loading">${t('export_loading')}</h3>
            <p style="color: var(--text-secondary); font-size: 0.875rem;" data-i18n="export_downloading">${t('export_downloading')}</p>
          </div>

          <button id="close-modal" style="position: absolute; right: 1.25rem; top: 1.25rem; background: transparent; color: var(--text-secondary); border: none; font-size: 1.5rem; cursor: pointer; transition: color 0.2s;">&times;</button>
          
          <h3 style="margin-bottom: 0.5rem; font-size: 1.5rem;" data-i18n="btn_export">${t('btn_export')}</h3>
          <p style="color: var(--text-secondary); margin-bottom: 1.5rem; font-size: 0.95rem;">Select a format to download the cloned website.</p>
          
          <div class="export-grid">
            
            <div class="export-card btn-export-option" data-format="zip">
              <div class="export-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V3h13l5 5z"></path><path d="M21 8h-5V3"></path><path d="M12 12v6"></path><path d="M9 15l3 3 3-3"></path></svg>
              </div>
              <div class="export-title" data-i18n="export_zip">${t('export_zip')}</div>
              <div class="export-desc" data-i18n="export_desc_zip">${t('export_desc_zip')}</div>
            </div>

            <div class="export-card btn-export-option" data-format="html">
              <div class="export-icon" style="color: #e34c26;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>
              </div>
              <div class="export-title" data-i18n="export_html">${t('export_html')}</div>
              <div class="export-desc" data-i18n="export_desc_html">${t('export_desc_html')}</div>
            </div>

            <div class="export-card btn-export-option" data-format="single">
              <div class="export-icon" style="color: #f59e0b;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
              </div>
              <div class="export-title" data-i18n="export_single">${t('export_single')}</div>
              <div class="export-desc" data-i18n="export_desc_single">${t('export_desc_single')}</div>
            </div>

            <div class="export-card btn-export-option" data-format="react">
              <div class="export-icon" style="color: #61dafb;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"></ellipse><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"></ellipse><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(90 12 12)"></ellipse></svg>
              </div>
              <div class="export-title" data-i18n="export_react">${t('export_react')}</div>
              <div class="export-desc" data-i18n="export_desc_react">${t('export_desc_react')}</div>
            </div>

            <div class="export-card btn-export-option" data-format="nextjs">
              <div class="export-icon" style="color: #ffffff;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M15 15l-3-4-3 4"></path><path d="M9 9l3 4 3-4"></path></svg>
              </div>
              <div class="export-title" data-i18n="export_nextjs">${t('export_nextjs')}</div>
              <div class="export-desc" data-i18n="export_desc_nextjs">${t('export_desc_nextjs')}</div>
            </div>

            <div class="export-card btn-export-option" data-format="vue">
              <div class="export-icon" style="color: #42b883;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 22h20L12 2z"></path><path d="M12 8l-6 14h12L12 8z"></path></svg>
              </div>
              <div class="export-title" data-i18n="export_vue">${t('export_vue')}</div>
              <div class="export-desc" data-i18n="export_desc_vue">${t('export_desc_vue')}</div>
            </div>

          </div>
        </div>
      </div>
    `;
    
    await this.loadDetails();
    return this.container;
  }

  async loadDetails() {
    try {
      const data = await getCloneDetails(this.cloneId);
      const { clone, pages } = data;
      
      this.container.querySelector('#prev-domain').textContent = clone.domain;
      this.container.querySelector('#prev-pages').textContent = clone.pages_downloaded;
      this.container.querySelector('#prev-size').textContent = (clone.total_size_bytes / 1024 / 1024).toFixed(2);
      
      this.buildSitemap(pages);
      
      if (pages.length > 0) {
        // Find index or first page
        let startPage = pages.find(p => p.local_path === 'index.html') || pages[0];
        this.loadIframe(startPage.local_path);
      }
      
      this.bindEvents();
      
    } catch (e) {
      console.error(e);
      toast.error('Failed to load preview');
    }
  }

  buildSitemap(pages) {
    const treeEl = this.container.querySelector('#sitemap-tree');
    treeEl.innerHTML = '';
    
    // Simple flat list for now, styled as a tree
    pages.forEach(page => {
      const li = document.createElement('li');
      li.style.cssText = `
        padding: 0.5rem;
        cursor: pointer;
        border-radius: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--text-secondary);
        transition: background 0.2s, color 0.2s;
      `;
      li.title = page.title || page.url;
      li.textContent = `📄 ${page.local_path}`;
      
      li.addEventListener('mouseover', () => {
        if (!li.classList.contains('active')) {
          li.style.background = 'var(--bg-hover)';
          li.style.color = 'var(--text-primary)';
        }
      });
      li.addEventListener('mouseout', () => {
        if (!li.classList.contains('active')) {
          li.style.background = 'transparent';
          li.style.color = 'var(--text-secondary)';
        }
      });
      
      li.addEventListener('click', () => {
        // Remove active class from all
        treeEl.querySelectorAll('li').forEach(el => {
          el.classList.remove('active');
          el.style.background = 'transparent';
          el.style.color = 'var(--text-secondary)';
        });
        
        li.classList.add('active');
        li.style.background = 'rgba(6, 214, 160, 0.1)';
        li.style.color = 'var(--accent-primary)';
        
        this.loadIframe(page.local_path);
      });
      
      treeEl.appendChild(li);
    });
  }

  loadIframe(localPath) {
    const iframe = this.container.querySelector('#preview-frame');
    const addressBar = this.container.querySelector('#address-bar');
    
    // Construct the backend URL that serves the raw files
    const fileUrl = `http://localhost:3000/api/preview/${this.cloneId}/${localPath}`;
    iframe.src = fileUrl;
    addressBar.value = `clony://${this.cloneId}/${localPath}`;
  }

  bindEvents() {
    const modal = this.container.querySelector('#export-modal');
    
    this.container.querySelector('#btn-export').addEventListener('click', () => {
      modal.style.display = 'flex';
    });
    
    this.container.querySelector('#close-modal').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    // Close on click outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });

    this.container.querySelectorAll('.btn-export-option').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const format = e.currentTarget.dataset.format;
        const overlay = this.container.querySelector('#export-overlay');
        overlay.classList.add('active');
        
        try {
          const response = await fetch(`http://localhost:3000/api/export/${this.cloneId}/${format}`);
          if (!response.ok) throw new Error('Export failed');
          
          const blob = await response.blob();
          const downloadUrl = window.URL.createObjectURL(blob);
          
          // Get filename from Content-Disposition if available
          let filename = `clony-${this.cloneId}-${format}.zip`;
          const disposition = response.headers.get('content-disposition');
          if (disposition && disposition.indexOf('filename=') !== -1) {
            const matches = /filename="([^"]+)"/.exec(disposition);
            if (matches != null && matches[1]) filename = matches[1];
          }
          
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = downloadUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(downloadUrl);
          a.remove();
          
          modal.style.display = 'none';
        } catch (err) {
          console.error(err);
          alert('Failed to generate export.');
        } finally {
          overlay.classList.remove('active');
        }
      });
    });

    const iframeContainer = this.container.querySelector('#iframe-container');
    const btnMaximize = this.container.querySelector('#btn-maximize');
    
    if (btnMaximize && iframeContainer) {
      btnMaximize.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          iframeContainer.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
          });
        } else {
          document.exitFullscreen();
        }
      });
    }
  }
}
