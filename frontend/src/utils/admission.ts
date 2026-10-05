/**
 * 测次准入校核：按测法判定一个断面测次是否具备出流量成果的条件。
 *
 * 规则（按测法）：
 * - 流速仪：每条垂线应有 2 个及以上流速测点
 * - 浮标：应有 3 条及以上垂线，且每条垂线均有测点
 * - ADCP：每条垂线有 1 个测点即可
 *
 * 通用规则：水深缺失（depthM 非正有限数）或流速全为零的垂线按待补测处理；
 * 只要存在待补测垂线（或测法级要求未满足），该测次暂不出流量成果，
 * 补齐数据后校核自动转为通过（页面与导出均基于实时数据计算，无需手工刷新）。
 */
import type { MeasureMethod } from '@/types/section'
import type { Vertical } from '@/types/vertical'
import type { Point } from '@/types/point'

/** 测次准入状态 */
export type AdmissionStatus = '可出成果' | '待补测'

/** 各测法的准入要求说明（页面提示与导出页共用） */
export const METHOD_REQUIREMENT_TEXT: Record<MeasureMethod, string> = {
  流速仪: '流速仪法：每条垂线应有 2 个及以上流速测点',
  浮标: '浮标法：应有 3 条及以上垂线，且每条垂线均有测点',
  ADCP: 'ADCP 法：每条垂线有 1 个测点即可'
}

/** 浮标法最少垂线条数 */
export const FLOAT_MIN_VERTICALS = 3

/** 单条垂线的校核结论 */
export interface VerticalAdmission {
  id: string
  no: number
  /** 该垂线是否通过校核 */
  ok: boolean
  /** 未通过原因（水深缺失 / 流速全为零 / 无测点 / 测点不足） */
  reasons: string[]
}

/** 整个测次的准入校核结论 */
export interface SectionAdmission {
  method: MeasureMethod
  /** 全部校核通过 = 可出流量成果 */
  ok: boolean
  status: AdmissionStatus
  /** 逐垂线校核结论（与垂线列表同序） */
  verticals: VerticalAdmission[]
  /** 待补测垂线（ok = false 的子集） */
  pending: VerticalAdmission[]
  /** 测法级未通过原因（如浮标法垂线条数不足、尚未布设垂线） */
  sectionReasons: string[]
  /** 汇总说明：未通过时写清缺哪条垂线、缺什么 */
  summary: string
}

/** 校核单条垂线：通用规则（水深、流速）+ 测法要求的测点数 */
export function checkVerticalAdmission(
  vertical: Pick<Vertical, 'id' | 'no' | 'depthM'>,
  points: Array<Pick<Point, 'velocityMs'>>,
  method: MeasureMethod
): VerticalAdmission {
  const reasons: string[] = []
  if (!Number.isFinite(vertical.depthM) || vertical.depthM <= 0) {
    reasons.push('水深缺失')
  }
  if (points.length === 0) {
    reasons.push('无流速测点')
  } else {
    const velocities = points.map((point) => point.velocityMs).filter((value) => Number.isFinite(value))
    if (velocities.length > 0 && velocities.every((value) => value <= 0)) {
      reasons.push('流速全为零')
    }
    // 测法要求的每垂线测点数：流速仪 ≥2，浮标 / ADCP ≥1（≥1 已由「无流速测点」覆盖）
    const requiredPoints = method === '流速仪' ? 2 : 1
    if (points.length < requiredPoints) {
      reasons.push(`测点不足（${method}法每垂线需 ${requiredPoints} 点以上，现 ${points.length} 点）`)
    }
  }
  return { id: vertical.id, no: vertical.no, ok: reasons.length === 0, reasons }
}

/**
 * 校核整个测次：逐垂线校核 + 测法级要求。
 * 任一垂线待补测或测法级要求未满足时，该测次不出流量成果。
 */
export function checkSectionAdmission(
  method: MeasureMethod,
  verticals: Array<Pick<Vertical, 'id' | 'no' | 'depthM'>>,
  pointsOfVertical: (verticalId: string) => Array<Pick<Point, 'velocityMs'>>
): SectionAdmission {
  const rows = verticals.map((vertical) => checkVerticalAdmission(vertical, pointsOfVertical(vertical.id), method))
  const pending = rows.filter((row) => !row.ok)

  const sectionReasons: string[] = []
  if (verticals.length === 0) {
    sectionReasons.push('尚未布设垂线')
  } else if (method === '浮标' && verticals.length < FLOAT_MIN_VERTICALS) {
    sectionReasons.push(`浮标法需 ${FLOAT_MIN_VERTICALS} 条以上垂线，现 ${verticals.length} 条`)
  }

  const ok = sectionReasons.length === 0 && pending.length === 0
  const summary = ok
    ? `${method}法准入校核通过，可出流量成果`
    : [
        ...sectionReasons,
        ...pending.map((row) => `垂线 ${row.no}：${row.reasons.join('、')}`)
      ].join('；')

  return {
    method,
    ok,
    status: ok ? '可出成果' : '待补测',
    verticals: rows,
    pending,
    sectionReasons,
    summary
  }
}
