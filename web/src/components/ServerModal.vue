<script setup>
import { computed, ref, watch } from 'vue';
import { NForm, NFormItem, NInput, NModal } from 'naive-ui';
import { CheckmarkOutline, CloseOutline } from '@vicons/ionicons5';
import IconBtn from './IconBtn.vue';
import { useServersStore } from '../stores/servers';
import { toast } from '../utils/toast';

/* Add / edit broker dialog. Mirrors the legacy modal behaviour:
 * name optional (falls back to first broker), brokers required — comma,
 * semicolon or newline separated; missing :port is completed server-side. */
const props = defineProps({
  show: { type: Boolean, default: false },
  editServer: { type: Object, default: null }, // null = create mode
});
const emit = defineEmits(['update:show', 'saved', 'created']);

const store = useServersStore();
const name = ref('');
const brokers = ref('');
const error = ref('');
const saving = ref(false);

const isEdit = computed(() => !!props.editServer);

watch(() => props.show, (open) => {
  if (!open) return;
  error.value = '';
  name.value = props.editServer?.name || '';
  brokers.value = (props.editServer?.brokers || []).join(', ');
});

function close() {
  emit('update:show', false);
}

function validate() {
  if (!brokers.value.trim()) return 'Bootstrap Server 不能为空';
  return '';
}

async function save() {
  error.value = validate();
  if (error.value) return;
  saving.value = true;
  try {
    if (isEdit.value) {
      await store.updateServer(props.editServer.id, { name: name.value, brokers: brokers.value });
      toast('服务器信息已更新', 'success');
      emit('saved');
    } else {
      const created = await store.addServer({ name: name.value, brokers: brokers.value });
      toast('已添加服务器，已进入工作区', 'success');
      emit('created', created);
    }
    close();
  } catch (err) {
    error.value = err.message || '保存失败';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="isEdit ? '编辑 Broker' : '添加 Broker'"
    class="server-modal"
    @update:show="(v) => emit('update:show', v)"
    @esc="close"
  >
    <n-form label-placement="top">
      <n-form-item label="名称（可选，默认取第一个地址）">
        <n-input v-model:value="name" placeholder="如：本地开发集群" maxlength="60" />
      </n-form-item>
      <n-form-item label="Bootstrap Server（必填，逗号/分号/换行分隔，缺端口默认 :9092）">
        <n-input
          v-model:value="brokers"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 8 }"
          placeholder="127.0.0.1:9092, 10.0.0.5:9092"
        />
      </n-form-item>
      <div v-if="error" class="modal-error">{{ error }}</div>
    </n-form>
    <template #footer>
      <div class="modal-actions">
        <IconBtn :icon="CloseOutline" title="取消" @click="close" />
        <IconBtn
          :icon="CheckmarkOutline"
          title="保存并关闭"
          type="primary"
          :loading="saving"
          @click="save"
        />
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.server-modal { width: 480px; max-width: calc(100vw - 48px); }
.modal-error {
  color: var(--kd-red);
  font-size: 13px;
  margin-top: -6px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
