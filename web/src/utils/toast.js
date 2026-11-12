import { createDiscreteApi } from 'naive-ui';
import { naiveTheme, themeOverrides } from '../theme/index.js';

/* Discrete message API so stores (outside components) can toast too;
 * theme follows the tri-state switch reactively.
 * Created lazily: importing this module must stay safe in Node (unit tests). */
let discrete = null;

function ensure() {
  if (!discrete) {
    discrete = createDiscreteApi(['message'], { theme: naiveTheme, themeOverrides });
  }
  return discrete;
}

export function toast(text, type = 'success') {
  const { message } = ensure();
  const fn = message[type] || message.info;
  fn(String(text), { duration: 3200, keepAliveOnHover: false });
}
