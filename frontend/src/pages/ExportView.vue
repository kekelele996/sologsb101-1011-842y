<script setup lang="ts">
/**
 * 模块 6：/export 比测偏差分析与结构版本查看
 * 按测站生成检测结论、展示比测偏差分析清单、导入导出全量 JSON。
 */
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Refresh, Upload, Warning } from '@element-plus/icons-vue'
import type { UploadFile } from 'element-plus'
import StatBadge from '@/components/common/StatBadge.vue'
import DeviationTag from '@/components/common/DeviationTag.vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import { useRatingStore } from '@/stores/ratingStore'
import { useStationStore } from '@/stores/stationStore'
import { useSectionStore } from '@/stores/sectionStore'
import {
  DB_NAME,
  DB_VERSION,
  countAll,
  readLastBackupAt,
  readStampedDbVersion,
  resetDatabase,
  type BackupPayload
} from '@/utils/db'
import {
  buildAdmissionRows,
  buildConclusionLines,
  countPayload,
  exportBackupJson,
  importBackup,
  readFileText,
  remapIds,
  validateBackup
} from '@/utils/export'
import { METHOD_REQUIREMENT_TEXT } from '@/utils/admission'

const ratingStore = useRatingStore()
const stationStore = useStationStore()
const sectionStore = useSectionStore()

const counts = ref<Record<string, number>>({})
const lastBackupAt = ref<string | null>(null)
const stampedVersion = ref<number>(DB_VERSION)
const overwriteOnImport = ref(true)
const fileList = ref<UploadFile[]>([])
const importing = ref(false)
const exporting = ref(false)

const compareRows = computed(() => ratingStore.compareRows)
const overLimitRows = computed(() => ratingStore.overLimitRows)

/**
 * 基于 store 实时数据的整库快照：测法改动、补测录入后结论与校核自动重算，
 * 无需手工刷新（原结论随数据变化即时失效）。
 */
const livePayload = computed<BackupPayload>(() => ({
  app: 'gbhydrogaug',
  dbVersion: DB_VERSION,
  exportedAt: '',
  stations: stationStore.stations,
  sections: sectionStore.sections,
  verticals: sectionStore.verticals,
  points: sectionStore.points,
  ratings: ratingStore.ratings,
  compares: ratingStore.compares
}))

/** 检测结论：按测站汇总测次、最新水位、定线参数、超限点据与准入校核 */
const conclusions = computed(() => buildConclusionLines(livePayload.value, ratingStore.allFits))

/** 测次准入校核清单：逐测次列出状态与待补测垂线 */
const admissionRows = computed(() => buildAdmissionRows(livePayload.value))
const pendingAdmissionCount = computed(() => admissionRows.value.filter((row) => !row.ok).length)

const methodRequirementText = computed(() => Object.values(METHOD_REQUIREMENT_TEXT).join('；'))

async function refreshCounts(): Promise<void> {
  counts.value = await countAll()
  lastBackupAt.value = readLastBackupAt()
  stampedVersion.value = readStampedDbVersion()
}

async function handleExport(): Promise<void> {
  exporting.value = true
  try {
    const result = await exportBackupJson()
    await refreshCounts()
    ElMessage.success(`已导出 ${result.fileName}（共 ${Object.values(result.counts).reduce((sum, value) => sum + value, 0)} 条记录）`)
  } finally {
    exporting.value = false
  }
}

async function handleImport(): Promise<void> {
  const file = fileList.value[0]?.raw
  if (!file) {
    ElMessage.warning('请先选择备份 JSON 文件')
    return
  }
  importing.value = true
  try {
    const text = await readFileText(file)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      ElMessage.error('文件不是合法的 JSON，无法解析')
      return
    }
    const validation = validateBackup(parsed)
    if (!validation.ok || !validation.payload) {
      ElMessage.error(`备份校验失败：${validation.errors.join('；')}`)
      return
    }
    const payload: BackupPayload = overwriteOnImport.value ? validation.payload : remapIds(validation.payload)
    const summary = countPayload(payload)
    await ElMessageBox.confirm(
      `将导入 ${Object.entries(summary)
        .map(([key, value]) => `${key} ${value} 条`)
        .join('、')}；${overwriteOnImport.value ? '覆盖模式会先清空现有本地数据' : '追加模式会重新分配 id 保留现有数据'}。确认继续？`,
      '导入确认',
      { type: 'warning', confirmButtonText: '继续导入', cancelButtonText: '取消' }
    )
    await importBackup(payload, overwriteOnImport.value)
    await refreshCounts()
    ElMessage.success('导入完成')
  } finally {
    importing.value = false
  }
}

async function handleReset(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      '将清空全部本地数据并重新播种演示数据（测站、断面、垂线、测点、点据、比测）。确认继续？',
      '重置本地数据',
      { type: 'warning', confirmButtonText: '清空并重建', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await resetDatabase()
  await refreshCounts()
  ElMessage.success('本地数据已重置为演示数据')
}

async function refreshAll(): Promise<void> {
  await ratingStore.rebuildCompares(ratingStore.activeLineNo)
  await refreshCounts()
  ElMessage.success('已重新定线并刷新结构版本信息')
}

onMounted(() => {
  void refreshAll()
})
</script>

<template>
  <section class="page">
    <div class="gb-brand-bar" />

    <div class="page__head">
      <div>
        <h2 class="page__title">比测偏差分析与导出</h2>
        <p class="gb-hint">
          按测站输出检测结论（测次数、最新水位、定线参数、超限点据），并可导出 / 导入全量 JSON 备份。
        </p>
      </div>
      <div class="page__actions">
        <el-button :icon="Refresh" @click="refreshAll">重新定线并刷新</el-button>
        <el-button type="primary" :icon="Download" :loading="exporting" @click="handleExport">导出 JSON</el-button>
      </div>
    </div>

    <div class="gb-stats-row">
      <StatBadge label="测站" :value="counts.stations ?? 0" suffix="站" icon="Odometer" />
      <StatBadge label="断面测次" :value="counts.sections ?? 0" suffix="次" icon="Files" tone="info" />
      <StatBadge label="流速测点" :value="counts.points ?? 0" suffix="点" icon="DataLine" tone="success" />
      <StatBadge
        label="待补测测次"
        :value="pendingAdmissionCount"
        suffix="次"
        :tone="pendingAdmissionCount > 0 ? 'danger' : 'success'"
        icon="WarningFilled"
      />
      <StatBadge
        label="比测合格率"
        :value="ratingStore.fitQuality.qualifyRatePct"
        suffix="%"
        :percent="ratingStore.fitQuality.qualifyRatePct"
        :tone="ratingStore.fitQuality.overLimitCount > 0 ? 'warning' : 'success'"
        icon="TrendCharts"
      />
    </div>

    <el-card shadow="never" class="gb-panel">
      <div class="gb-panel-title">
        <h3>检测结论（按测站）</h3>
        <span class="gb-hint">
          本地库 {{ DB_NAME }} · 结构版本 v{{ DB_VERSION }}（浏览器记录 v{{ stampedVersion }}）·
          最近备份 {{ lastBackupAt ? new Date(lastBackupAt).toLocaleString('zh-CN') : '尚未备份' }}
        </span>
      </div>
      <el-table :data="conclusions" border class="gb-table-compact">
        <el-table-column prop="stationName" label="测站" min-width="140" />
        <el-table-column prop="river" label="河名" width="110" />
        <el-table-column label="测次数" width="90" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.sectionCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最新水位 (m)" width="130" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.latestStageM === null ? '—' : row.latestStageM.toFixed(2) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="点据数" width="90" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.ratingCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="超限" width="90" align="right">
          <template #default="{ row }">
            <span class="gb-mono" :class="{ 'page__danger': row.overLimitCount > 0 }">{{ row.overLimitCount }}</span>
          </template>
        </el-table-column>
        <el-table-column label="准入校核" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="{ 'page__warn-text': row.admissionText.includes('待补测') }">{{ row.admissionText }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="fitText" label="定线成果" min-width="320" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-card shadow="never" class="gb-panel">
      <div class="gb-panel-title">
        <h3>
          测次准入校核
          <el-tag v-if="pendingAdmissionCount > 0" type="warning" size="small" effect="plain">
            <el-icon><Warning /></el-icon> {{ pendingAdmissionCount }} 次待补测
          </el-tag>
        </h3>
        <span class="gb-hint">{{ methodRequirementText }}；水深缺失或流速全为零的垂线按待补测，该测次暂不出流量成果</span>
      </div>

      <EmptyPanel
        v-if="admissionRows.length === 0"
        title="还没有断面测次"
        description="在测站台账中新建测站与测次后，这里会按测法逐次校核是否具备出流量成果的条件。"
        compact
      />

      <el-table v-else :data="admissionRows" border stripe class="gb-table-compact">
        <el-table-column prop="stationName" label="测站" min-width="120" />
        <el-table-column prop="measureNo" label="测次号" min-width="120" />
        <el-table-column label="测法" width="100" align="center">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.method === 'ADCP' ? 'success' : row.method === '浮标' ? 'warning' : 'primary'"
              effect="plain"
            >
              {{ row.method }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="row.ok ? 'success' : 'warning'" effect="plain">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="待补测明细（缺哪条垂线）" min-width="340" show-overflow-tooltip>
          <template #default="{ row }">
            <span :class="{ 'page__warn-text': !row.ok }">{{ row.pendingText }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="gb-panel">
      <div class="gb-panel-title">
        <h3>
          比测偏差分析清单
          <el-tag v-if="overLimitRows.length > 0" type="danger" size="small" effect="plain">
            <el-icon><Warning /></el-icon> {{ overLimitRows.length }} 条超限
          </el-tag>
        </h3>
        <span class="gb-hint">偏差 = (曲线流量 − 实测流量) / 实测流量 × 100%，限值 {{ ratingStore.deviationLimitPct }}%</span>
      </div>

      <EmptyPanel
        v-if="compareRows.length === 0"
        title="还没有比测记录"
        description="在关系点据页新增点据并执行「重新定线」后，系统会自动生成比测记录与偏差判定。"
        compact
      />

      <el-table v-else :data="compareRows" border stripe class="gb-table-compact">
        <el-table-column label="测站" min-width="130">
          <template #default="{ row }">{{ row.stationName }}</template>
        </el-table-column>
        <el-table-column label="定线号" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.lineNo }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="水位 (m)" width="110" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.rating ? row.rating.stageM.toFixed(2) : '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="实测流量" width="130" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.compare.measuredFlow.toFixed(1) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="曲线流量" width="130" align="right">
          <template #default="{ row }">
            <span class="gb-mono">{{ row.compare.curveFlow.toFixed(1) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="偏差判定" width="210">
          <template #default="{ row }">
            <DeviationTag
              :deviation-pct="row.compare.deviationPct"
              :verdict="row.compare.verdict"
              :limit="ratingStore.deviationLimitPct"
            />
          </template>
        </el-table-column>
        <el-table-column prop="compare.operator" label="比测人" width="100" />
        <el-table-column label="比测日期" min-width="150">
          <template #default="{ row }">
            <span class="gb-mono">{{ new Date(row.compare.comparedAt).toLocaleDateString('zh-CN') }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="gb-panel">
      <div class="gb-panel-title">
        <h3>全量 JSON 导入导出</h3>
        <span class="gb-hint">
          导出内容包含 stations / sections / verticals / points / ratings / compares 六张表
        </span>
      </div>

      <el-form label-width="120px">
        <el-form-item label="导入模式">
          <el-radio-group v-model="overwriteOnImport">
            <el-radio :value="true">覆盖（先清空本地数据）</el-radio>
            <el-radio :value="false">追加（重新分配 id）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="选择备份文件">
          <el-upload
            v-model:file-list="fileList"
            :auto-upload="false"
            :limit="1"
            accept="application/json"
            :on-exceed="() => ElMessage.warning('一次只能选择一个文件')"
          >
            <el-button :icon="Upload">选择 JSON 文件</el-button>
            <template #tip>
              <div class="gb-hint">仅支持本应用导出的备份文件（app 字段为 gbhydrogaug）</div>
            </template>
          </el-upload>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Upload" :loading="importing" @click="handleImport">开始导入</el-button>
          <el-button :icon="Download" @click="handleExport">导出当前数据</el-button>
          <el-button type="danger" plain @click="handleReset">清空并重建演示数据</el-button>
        </el-form-item>
      </el-form>

      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="本地库名">{{ DB_NAME }}</el-descriptions-item>
        <el-descriptions-item label="结构版本">v{{ DB_VERSION }}</el-descriptions-item>
        <el-descriptions-item label="测站 / 测次">
          {{ counts.stations ?? 0 }} / {{ counts.sections ?? 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="垂线 / 测点">
          {{ counts.verticals ?? 0 }} / {{ counts.points ?? 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="点据 / 比测">
          {{ counts.ratings ?? 0 }} / {{ counts.compares ?? 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="最近备份时间">
          {{ lastBackupAt ? new Date(lastBackupAt).toLocaleString('zh-CN') : '尚未备份' }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.page__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.page__title {
  margin: 0 0 4px;
  font-size: 19px;
  color: #0f4c75;
}

.page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.page__danger {
  color: #c0392b;
  font-weight: 700;
}

.page__warn-text {
  color: #b26a00;
}
</style>
