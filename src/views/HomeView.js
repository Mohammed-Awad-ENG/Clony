import { startClone } from '../utils/api.js';
import { toast } from '../components/Toast.js';
import { t } from '../i18n.js';

export default class HomeView {
  render() {
    this.container = document.createElement('div');
    this.container.className = 'home-view';
    this.container.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 70vh;
    `;

    this.container.innerHTML = `
      <div class="card" style="width: 100%; max-width: 600px; padding: 2.5rem;">
        <h2 style="text-align: center; margin-bottom: 2rem; color: var(--accent-primary);" data-i18n="nav_clone">
          ${t('nav_clone')}
        </h2>
        
        <form id="clone-form">
          <div class="form-group">
            <input type="url" id="url-input" class="form-control" required 
                   placeholder="${t('form_url_placeholder')}" data-i18n="form_url_placeholder"
                   style="font-size: 1.25rem; padding: 1rem;">
          </div>
          
          <details style="margin: 1.5rem 0;">
            <summary style="cursor: pointer; color: var(--text-secondary);" data-i18n="form_options">
              ${t('form_options')}
            </summary>
            <div style="margin-top: 1rem; padding: 1rem; background: var(--bg-deep); border-radius: 4px;">
              
              <div class="form-group">
                <label data-i18n="opt_depth">${t('opt_depth')}</label>
                <input type="number" id="opt-depth" class="form-control" min="0" placeholder="e.g. 1">
              </div>
              
              <div class="form-group">
                <label data-i18n="opt_max_pages">${t('opt_max_pages')}</label>
                <input type="number" id="opt-max-pages" class="form-control" value="500" min="1">
              </div>
              
              <div class="form-group">
                <label data-i18n="opt_delay">${t('opt_delay')}</label>
                <input type="number" id="opt-delay" class="form-control" value="1000" min="0">
              </div>
              
              <div class="form-group" style="display: flex; align-items: center; gap: 0.5rem;">
                <input type="checkbox" id="opt-robots" checked>
                <label for="opt-robots" style="margin: 0;" data-i18n="opt_robots">${t('opt_robots')}</label>
              </div>

            </div>
          </details>
          
          <button type="submit" class="btn btn-primary" style="width: 100%; font-size: 1.1rem; padding: 1rem;" data-i18n="form_btn_clone">
            ${t('form_btn_clone')}
          </button>
        </form>
      </div>
    `;

    this.bindEvents();
    return this.container;
  }

  bindEvents() {
    const form = this.container.querySelector('#clone-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const url = this.container.querySelector('#url-input').value;
      const depthVal = this.container.querySelector('#opt-depth').value;
      const maxPages = parseInt(this.container.querySelector('#opt-max-pages').value, 10);
      const rateLimitMs = parseInt(this.container.querySelector('#opt-delay').value, 10);
      const respectRobots = this.container.querySelector('#opt-robots').checked;
      
      const options = {
        maxPages: isNaN(maxPages) ? 500 : maxPages,
        rateLimitMs: isNaN(rateLimitMs) ? 1000 : rateLimitMs,
        respectRobots
      };
      
      if (depthVal !== '') {
        options.depth = parseInt(depthVal, 10);
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';

      try {
        const result = await startClone(url, options);
        toast.success(result.message);
        window.router.navigate(`/progress/${result.id}`);
      } catch (err) {
        toast.error(err.message || 'Failed to start cloning');
      } finally {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
      }
    });
  }
}
