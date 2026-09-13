import './app.css';
import App from './App.svelte';

/** Mounts the root Svelte component into the page's #app element. */
const app = new App({
  target: document.getElementById('app'),
});

export default app;
