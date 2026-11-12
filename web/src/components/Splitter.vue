<script setup>
import { onBeforeUnmount } from 'vue';

/* Draggable divider. `horizontal` = a row divider (adjusts height, row-resize);
 * default = a column divider (adjusts width, col-resize). Emits `drag` with
 * the raw mouse event; the parent does the math against its own rect. */
const props = defineProps({
  horizontal: { type: Boolean, default: false },
});
const emit = defineEmits(['drag']);

let moving = false;

function onMouseMove(ev) {
  if (moving) emit('drag', ev);
}

function onMouseUp() {
  moving = false;
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  document.body.classList.remove('is-splitting');
}

function onDown(e) {
  e.preventDefault();
  moving = true;
  document.body.classList.add('is-splitting');
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
});
</script>

<template>
  <div
    class="splitter"
    :class="{ horizontal: props.horizontal }"
    role="separator"
    @mousedown="onDown"
  >
    <span class="grip" />
  </div>
</template>

<style scoped>
.splitter {
  flex: 0 0 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  touch-action: none;
}
.splitter.horizontal {
  flex: 0 0 7px;
  width: 100%;
  cursor: row-resize;
}
.grip {
  border-radius: 999px;
  background: rgba(128, 128, 128, 0.28);
  transition: background 0.15s ease;
}
.splitter:hover .grip { background: #007aff; }
/* vertical divider: a 3px × 28px bar */
.grip { width: 3px; height: 28px; }
/* horizontal divider: a bar 28px wide and 3px high */
.splitter.horizontal .grip { width: 28px; height: 3px; }
</style>

<style>
/* dragging state must be global (body is outside the component scope) */
body.is-splitting { cursor: col-resize; user-select: none; }
body.is-splitting .splitter.horizontal { cursor: row-resize; }
</style>
