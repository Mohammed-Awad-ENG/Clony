export class ToastManager {
  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }

  show(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    this.container.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideInRight 0.3s ease-in reverse forwards';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  error(message, duration = 5000) {
    this.show(message, 'error', duration);
  }

  success(message, duration = 3000) {
    this.show(message, 'success', duration);
  }
}

export const toast = new ToastManager();
