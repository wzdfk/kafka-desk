import { createDiscreteApi } from 'naive-ui';
import { naiveTheme, themeOverrides } from '../theme/index.js';

/* Discrete dialog API for confirmations outside components (lazy for Node tests). */
let discrete = null;

function ensure() {
  if (!discrete) {
    discrete = createDiscreteApi(['dialog'], { theme: naiveTheme, themeOverrides });
  }
  return discrete;
}

export function confirmDialog({ title, content, positiveText = '确定', negativeText = '取消', onPositiveClick }) {
  const { dialog } = ensure();
  dialog.warning({
    title,
    content,
    positiveText,
    negativeText,
    onPositiveClick,
  });
}
