/**
 * 测次成果准入校核：按测法校验垂线测点数与垂线条数，
 * 并识别水深缺失 / 流速全零的待补测垂线。
 * 页面、store 与导出共用同一套规则，保证展示与判定一致。
 */
import type { MeasureMethod } from '@/types/section'
import type { Vertical } from '@/types/vertical'
import type { Point } from '@/types/point'

/** 单条垂线的准入校核结果 */
export interface VerticalAdmission {
  verticalId: string
  no: number
  startDistanceM: number
  depthM: number
  pointCount: number
  /** 待补测 / 未通过的原因（人话） */
  reasons: string[]
  /** 是否待补测（水深缺失或流速全零） */
  pending: boolean
  /** 是否未通过测法准入（测点 / 垂线数不足） */
  failed: boolean
}

/** 测次（断面）准入校核结果 */
export interface SectionAdmission {
  sectionId: string
  method: MeasureMethod
  /** 是否可出成果 */
  admissible: boolean
  /** 垂线条数 */
  verticalCount: number
  /** 测点合计 */
  pointCount: number
  /** 存在问题的垂线（待补测 + 准入失败），按垂线号升序 */
  problemVerticals: VerticalAdmission[]
  /** 待补测垂线（水深缺失 / 流速全零） */
  pendingVerticals: VerticalAdmission[]
  /** 准入校核未通过的垂线（测点 / 垂线数不足） */
  failedVerticals: VerticalAdmission[]
  /** 汇总结论（人话） */
  conclusion: string
}

/** 各测法的准入规则 */
interface MethodRule {
  /** 每条垂线最少测点数 */
  minPointsPerVertical: number
  /** 最少垂线条数 */
  minVerticals: number
}

const METHOD_RULES: Record<MeasureMethod, MethodRule> = {
  流速仪: { minPointsPerVertical: 2, minVerticals: 1 },
  浮标: { minPointsPerVertical: 1, minVerticals: 3 },
  ADCP: { minPointsPerVertical: 1, minVerticals: 1 }
}

/** 取某测法的准入规则（未知测法回退到流速仪） */
export function methodRule(method: MeasureMethod): MethodRule {
  return METHOD_RULES[method] ?? METHOD_RULES['流速仪']
}

/**
 * 准入校核：传入测次、其全部垂线与全部测点，返回该测次是否可出成果。
 * 规则：
 * - 流速仪：每条垂线 ≥ 2 个流速测点
 * - 浮标：≥ 3 条垂线，且每条有测点
 * - ADCP：每条垂线 ≥ 1 个测点
 * - 水深缺失或流速全为零的垂线按待补测算，该测次暂不出流量
 */
export function checkSectionAdmission(
  sectionId: string,
  method: MeasureMethod,
  verticals: Vertical[],
  points: Point[]
): SectionAdmission {
  const rule = methodRule(method)
  const sorted = [...verticals].sort((a, b) => a.startDistanceM - b.startDistanceM)

  const verticalAdmissions: VerticalAdmission[] = sorted.map((vertical) => {
    const vPoints = points
      .filter((point) => point.verticalId === vertical.id)
      .sort((a, b) => a.relativeDepth - b.relativeDepth)
    const reasons: string[] = []
    let pending = false
    let failed = false

    // 待补测：水深缺失（非有限数或 ≤ 0）
    const depthMissing = !Number.isFinite(vertical.depthM) || vertical.depthM <= 0
    if (depthMissing) {
      reasons.push('水深缺失')
      pending = true
    }

    // 待补测：流速全为零（有测点但全部为 0）
    const hasPoints = vPoints.length > 0
    const allZero = hasPoints && vPoints.every((point) => !Number.isFinite(point.velocityMs) || point.velocityMs === 0)
    if (hasPoints && allZero) {
      reasons.push('流速全为零')
      pending = true
    }

    // 准入校核：测点数不足
    if (vPoints.length < rule.minPointsPerVertical) {
      reasons.push(`测点不足（需 ≥ ${rule.minPointsPerVertical} 点，现有 ${vPoints.length} 点）`)
      failed = true
    }

    return {
      verticalId: vertical.id,
      no: vertical.no,
      startDistanceM: vertical.startDistanceM,
      depthM: vertical.depthM,
      pointCount: vPoints.length,
      reasons,
      pending,
      failed
    }
  })

  const verticalCount = sorted.length
  const pointCount = verticalAdmissions.reduce((sum, item) => sum + item.pointCount, 0)
  const pendingVerticals = verticalAdmissions.filter((item) => item.pending)
  const failedVerticals = verticalAdmissions.filter((item) => item.failed)
  const problemVerticals = verticalAdmissions.filter((item) => item.pending || item.failed)

  const hasVerticals = verticalCount > 0
  const verticalShortage = method === '浮标' && verticalCount < rule.minVerticals
  const admissible = hasVerticals && !verticalShortage && problemVerticals.length === 0

  let conclusion = ''
  if (!hasVerticals) {
    conclusion = '尚无垂线，无法出成果'
  } else if (admissible) {
    conclusion = '准入校核通过，可出成果'
  } else {
    const parts: string[] = []
    if (verticalShortage) {
      parts.push(`浮标法需 ≥ ${rule.minVerticals} 条垂线（现有 ${verticalCount} 条）`)
    }
    if (pendingVerticals.length > 0) {
      const detail = pendingVerticals.map((item) => `第 ${item.no} 条（${item.reasons.join('、')}）`).join('；')
      parts.push(`${pendingVerticals.length} 条垂线待补测：${detail}`)
    }
    if (failedVerticals.length > 0) {
      const detail = failedVerticals.map((item) => `第 ${item.no} 条`).join('、')
      parts.push(`${failedVerticals.length} 条垂线测点不足：${detail}`)
    }
    conclusion = parts.join('；')
  }

  return {
    sectionId,
    method,
    admissible,
    verticalCount,
    pointCount,
    problemVerticals,
    pendingVerticals,
    failedVerticals,
    conclusion
  }
}
