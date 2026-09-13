import './app.css';
import App from './App.svelte';

/**
 * Mounts the root Svelte component into the page's #app element.
 *
 * @domain Web App Bootstrap
 * @flow Startup
 */
const app = new App({
  target: document.getElementById('app'),
});

export default app;
