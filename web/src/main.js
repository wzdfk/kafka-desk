import { createApp } from 'vue';
import { createPinia } from 'pinia';
import naive from 'naive-ui';
import App from './App.vue';
import router from './router/index.js';
import { initTheme } from './theme/index.js';
import { usePrefsStore } from './stores/prefs.js';
import { useSyslogStore } from './stores/syslog.js';
import { useServersStore } from './stores/servers.js';

initTheme();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(naive);
app.mount('#app');

usePrefsStore().init();
useSyslogStore().init();
useServersStore().init();
