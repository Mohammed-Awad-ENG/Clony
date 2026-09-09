import './styles/index.css';
import './styles/components.css';
import './styles/rtl.css';

import { Router } from './router.js';
import { initI18n } from './i18n.js';
import { Header } from './components/Header.js';
import { Disclaimer } from './components/Disclaimer.js';

const routes = [
  { path: '/', view: () => import('./views/HomeView.js') },
  { path: '/library', view: () => import('./views/LibraryView.js') },
  { path: '/progress/:id', view: () => import('./views/ProgressView.js') },
  { path: '/preview/:id', view: () => import('./views/PreviewView.js') }
];

async function bootstrap() {
  await initI18n();
  
  const root = document.getElementById('root');
  root.innerHTML = '';
  
  const header = new Header();
  root.appendChild(header.render());
  
  const appContainer = document.createElement('main');
  appContainer.id = 'app';
  appContainer.className = 'container';
  root.appendChild(appContainer);
  
  const disclaimer = new Disclaimer();
  root.appendChild(disclaimer.render());
  
  const router = new Router(routes);
  router.init();
  
  // Attach router to window for easy navigation
  window.router = router;
}

bootstrap();
