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
        <router-view />
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
  max-width: 1440px;
  margin: 0 auto;
  padding: 16px 24px 20px;
  box-sizing: border-box;
  overflow-y: auto;
}
</style>
