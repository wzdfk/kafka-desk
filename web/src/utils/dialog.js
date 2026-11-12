import { createDiscreteApi } from 'naive-ui';
import { naiveTheme, themeOverrides } from '../theme/index.js';

/* Discrete dialog API for confirmations outside components (lazy for Node tests). */
let discrete = null;

function ensure() {
  if (typeof document === 'undefined') return null; // Node tests / SSR
  if (!discrete) {
    discrete = createDiscreteApi(['dialog'], { theme: naiveTheme, themeOverrides });
  }
  return discrete;
}

export function confirmDialog({ title, content, positiveText = '确定', negativeText = '取消', onPositiveClick }) {
  const api = ensure();
  if (!api) {
    console.log(`[dialog] ${title}: ${content}`);
    return;
  }
  api.dialog.warning({
    title,
    content,
    positiveText,
    negativeText,
    onPositiveClick,
  });
}
