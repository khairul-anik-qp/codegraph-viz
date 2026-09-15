<script>
  // Floating action button, fixed at the bottom-right of the viewport —
  // currently the home for the theme switcher. A FAB (rather than a header
  // button) keeps it reachable regardless of scroll/view and leaves room to
  // grow into a menu of quick actions later without crowding the header.
  import { themeMode } from './stores.js';

  const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };
  const THEME_ICON = { system: '🖥', light: '☀', dark: '🌙' };
  const THEME_LABEL = { system: 'Theme: system (click to cycle)', light: 'Theme: light (click to cycle)', dark: 'Theme: dark (click to cycle)' };
  function cycleTheme() { themeMode.set(THEME_CYCLE[$themeMode]); }
</script>

<button
  type="button"
  class="theme-fab"
  data-tip={THEME_LABEL[$themeMode]}
  aria-label={THEME_LABEL[$themeMode]}
  on:click={cycleTheme}
>
  {#key $themeMode}
    <span class="fab-icon">{THEME_ICON[$themeMode]}</span>
  {/key}
</button>

<style>
  .theme-fab {
    position: fixed;
    right: 22px;
    bottom: 22px;
    z-index: 250;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12);
    transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.15s ease, border-color 0.15s ease;
  }
  .theme-fab:hover {
    transform: translateY(-2px) scale(1.06);
    border-color: var(--accent);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22), 0 2px 5px rgba(0, 0, 0, 0.14);
  }
  .theme-fab:active {
    transform: translateY(0) scale(0.96);
    transition-duration: 0.05s;
  }
  .fab-icon {
    font-size: 20px;
    line-height: 1;
    display: inline-block;
    animation: fab-pop 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes fab-pop {
    from { transform: scale(0.5) rotate(-25deg); opacity: 0; }
    to { transform: scale(1) rotate(0); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .theme-fab, .fab-icon { transition: none; animation: none; }
  }
</style>
