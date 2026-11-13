import { createRouter, createWebHashHistory } from 'vue-router';
import ServerList from '../views/ServerList.vue';
import Workspace from '../views/Workspace.vue';
import Settings from '../views/Settings.vue';
import { useServersStore } from '../stores/servers.js';

/* Hash history: works with any static hosting and deep links (legacy parity). */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: ServerList },
    { path: '/server/:id', name: 'workspace', component: Workspace },
    { path: '/settings', name: 'settings', component: Settings },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.afterEach((to) => {
  const store = useServersStore();
  if (to.name === 'workspace') {
    store.setActiveId(String(to.params.id));
  } else {
    store.setActiveId('');
  }
});

export default router;
