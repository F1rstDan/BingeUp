/**
 * Shared visual foundation for isolated Shadow DOM roots.
 *
 * This is deliberately the smallest token subset used by the overlay and enable prompt;
 * extension-page-only tokens stay in design-tokens.css.
 */
export const SHADOW_DESIGN_TOKENS = `
  :host {
    --bingeup-blue: #0a86e6;
    --bingeup-blue-dark: #0768b5;
    --bingeup-blue-soft: #e8f5ff;
    --bingeup-pink: #ff7e99;
    --bingeup-pink-dark: #e75e7b;
    --bingeup-pink-soft: #fff0f3;
    --bingeup-green: #10c26b;
    --bingeup-green-dark: #079451;
    --bingeup-green-soft: #eafff3;
    --bingeup-yellow: #ffc947;
    --bingeup-ink: #1f2937;
    --bingeup-muted: #7d8b9d;
    --bingeup-line: #e5edf4;
    --bingeup-canvas: #f5f8fb;
    --bingeup-white: #fff;
    --bingeup-radius-lg: 24px;
    --bingeup-radius-md: 16px;
    --bingeup-shadow: 0 18px 48px rgba(35, 75, 112, 0.1);
    --bingeup-font: "Nunito", "Trebuchet MS", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    all: initial;
  }
  *, *::before, *::after { box-sizing: border-box; }
  button, input { font-family: var(--bingeup-font); }
  button:focus-visible, input:focus-visible { outline: 3px solid rgba(10, 134, 230, .28); outline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
  }
`;
