<script setup>
import { NConfigProvider, NGlobalStyle, dateZhCN, zhCN } from 'naive-ui';
import { naiveTheme, themeOverrides } from './theme';
import TopBar from './components/TopBar.vue';
</script>

<template>
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-global-style />
    <div class="app-shell">
      <TopBar />
      <main class="app-main">
        <router-view v-slot="{ Component }">
          <transition name="kd-fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </n-config-provider>
</template>

<style>
.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.app-main {
  flex: 1;
  min-height: 0;
  width: 100%;
  /* max-width: 1440px; */
  margin: 0 auto;
  padding: 14px 20px 16px;
  box-sizing: border-box;
  overflow-y: auto;
}

/* Route change: quick fade + tiny lift (Apple-ish, respects reduced motion). */
.kd-fade-enter-active,
.kd-fade-leave-active {
  transition: opacity 0.18s var(--kd-ease), transform 0.18s var(--kd-ease);
}
.kd-fade-enter-from { opacity: 0; transform: translateY(4px); }
.kd-fade-leave-to { opacity: 0; }
</style>
