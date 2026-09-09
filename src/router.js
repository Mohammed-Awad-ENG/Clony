export class Router {
  constructor(routes) {
    this.routes = routes;
    this.currentView = null;
    
    window.addEventListener('hashchange', () => this.handleRoute());
  }

  init() {
    this.handleRoute();
  }

  async handleRoute() {
    let hash = window.location.hash.slice(1) || '/';
    
    // Parse route and params
    let matchedRoute = null;
    let params = {};
    
    for (const route of this.routes) {
      if (route.path === hash) {
        matchedRoute = route;
        break;
      }
      // Simple parameter matching (e.g., /clone/:id)
      if (route.path.includes(':')) {
        const routeParts = route.path.split('/');
        const hashParts = hash.split('/');
        
        if (routeParts.length === hashParts.length) {
          let match = true;
          const extractedParams = {};
          
          for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith(':')) {
              extractedParams[routeParts[i].slice(1)] = hashParts[i];
            } else if (routeParts[i] !== hashParts[i]) {
              match = false;
              break;
            }
          }
          
          if (match) {
            matchedRoute = route;
            params = extractedParams;
            break;
          }
        }
      }
    }

    if (!matchedRoute) {
      window.location.hash = '/';
      return;
    }

    const appContainer = document.getElementById('app');
    
    if (this.currentView && this.currentView.unmount) {
      this.currentView.unmount();
    }
    
    appContainer.innerHTML = '';
    
    // Lazy load the view
    const ViewModule = await matchedRoute.view();
    const ViewClass = ViewModule.default;
    
    this.currentView = new ViewClass(params);
    const viewNode = await this.currentView.render();
    appContainer.appendChild(viewNode);
    
    if (this.currentView.mount) {
      this.currentView.mount();
    }
    
    // Update active nav links
    document.querySelectorAll('.nav-links a').forEach(a => {
      a.classList.remove('active');
      if (a.getAttribute('href') === '#' + hash || (hash !== '/' && a.getAttribute('href').startsWith('#' + hash.split('/')[1]))) {
        a.classList.add('active');
      }
    });
  }

  navigate(path) {
    window.location.hash = path;
  }
}
