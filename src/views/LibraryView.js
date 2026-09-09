import { fetchClones, deleteClone } from '../utils/api.js';
import { toast } from '../components/Toast.js';
import { t } from '../i18n.js';
import { socket } from '../utils/socket.js';

export default class LibraryView {
  async render() {
    this.container = document.createElement('div');
    this.container.className = 'library-view';
    this.container.style.padding = '2rem 0';
    
    this.container.innerHTML = `
      <h2 style="margin-bottom: 2rem;" data-i18n="nav_library">${t('nav_library')}</h2>
      <div id="clones-grid" class="card-grid"></div>
    `;
    
    await this.loadClones();
    
    this.handleStatusUpdate = this.handleStatusUpdate.bind(this);
    socket.on('clone-status', this.handleStatusUpdate);
    
    return this.container;
  }
  
  unmount() {
    socket.off('clone-status', this.handleStatusUpdate);
  }
  
  handleStatusUpdate(data) {
    const card = this.container.querySelector(`.clone-card[data-id="${data.id}"]`);
    if (card) {
      const statusBadge = card.querySelector('.status-badge');
      if (statusBadge) {
        statusBadge.textContent = t(`lib_status_${data.status}`) || data.status;
        statusBadge.className = `status-badge ${data.status}`;
      }
    } else {
      this.loadClones(); // Reload if new clone
    }
  }

  async loadClones() {
    const grid = this.container.querySelector('#clones-grid');
    grid.innerHTML = '<div class="loader">Loading...</div>';
    
    try {
      const clones = await fetchClones();
      
      if (clones.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-secondary);" data-i18n="lib_empty">
            ${t('lib_empty')}
          </div>
        `;
        return;
      }
      
      grid.innerHTML = '';
      
      clones.forEach(clone => {
        const card = document.createElement('div');
        card.className = 'card clone-card';
        card.dataset.id = clone.id;
        card.style.cssText = `
          display: flex;
          flex-direction: column;
          gap: 1rem;
          transition: transform 0.2s, box-shadow 0.2s;
        `;
        
        const date = new Date(clone.created_at).toLocaleString();
        const statusText = t(`lib_status_${clone.status}`) || clone.status;
        
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="overflow: hidden;">
              <h3 style="margin: 0; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${clone.url}">
                ${clone.domain}
              </h3>
              <div style="font-size: 0.8rem; color: var(--text-secondary);">${date}</div>
            </div>
            <span class="status-badge ${clone.status}" style="font-size: 0.75rem; padding: 0.25rem 0.5rem; border-radius: 99px; background: var(--bg-hover);">${statusText}</span>
          </div>
          
          <div style="display: flex; gap: 1rem; font-size: 0.875rem; color: var(--text-secondary);">
            <div><strong style="color: var(--text-primary);">${clone.pages_downloaded}</strong> ${t('prog_downloaded')}</div>
            <div><strong style="color: var(--text-primary);">${(clone.total_size_bytes / 1024 / 1024).toFixed(2)}</strong> MB</div>
          </div>
          
          <div style="margin-top: auto; display: flex; gap: 0.5rem; flex-wrap: wrap;">
            ${clone.status === 'crawling' || clone.status === 'queued' ? 
              `<a href="#/progress/${clone.id}" class="btn btn-primary" style="flex: 1; font-size: 0.875rem;">View Progress</a>` :
              `<a href="#/preview/${clone.id}" class="btn btn-secondary" style="flex: 1; font-size: 0.875rem;" data-i18n="btn_preview">${t('btn_preview')}</a>`
            }
            <button class="btn btn-danger btn-delete" data-id="${clone.id}" style="padding: 0.5rem;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18"></path>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        `;
        
        // Delete handler
        card.querySelector('.btn-delete').addEventListener('click', async (e) => {
          if (confirm('Are you sure you want to delete this clone?')) {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await deleteClone(clone.id);
              toast.success('Clone deleted');
              this.loadClones();
            } catch (err) {
              toast.error('Failed to delete');
              btn.disabled = false;
            }
          }
        });
        
        grid.appendChild(card);
      });
      
    } catch (error) {
      grid.innerHTML = `<div class="error">Failed to load library: ${error.message}</div>`;
    }
  }
}
