import React, { useState } from 'react'
import { Button, InputNumber, Select, Space, Tag, Tooltip } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import weekOfYear from 'dayjs/plugin/weekOfYear'

dayjs.extend(isoWeek)
dayjs.extend(weekOfYear)

// ─── 类型定义 ───────────────────────────────────────────────
export type Granularity = 'year' | 'half' | 'quarter' | 'month' | 'week' | 'day'

export interface TimeRange {
  granularity: Granularity
  startKey: string   // 统一格式 key，如 "2025", "2025-H1", "2025-Q2", "2025-04", "2025-W15", "2025-04-14"
  endKey: string
  label: string      // 人类可读标签，如 "2025年Q1 — 2025年Q3"
  startDate: Dayjs   // 区间起始日期（自然起始，方便接口传参）
  endDate: Dayjs     // 区间结束日期
}

interface Props {
  value?: TimeRange
  onChange?: (range: TimeRange) => void
  defaultGranularity?: Granularity
}

// ─── 工具函数 ──────────────────────────────────────────────
const GRANULARITY_LABELS: Record<Granularity, string> = {
  year: '年',
  half: '半年度',
  quarter: '季度',
  month: '月份',
  week: '周',
  day: '天',
}

/** key → 自然区间 [start, end] */
function keyToRange(key: string, g: Granularity): [Dayjs, Dayjs] {
  if (g === 'year') {
    const y = parseInt(key)
    return [dayjs(`${y}-01-01`), dayjs(`${y}-12-31`)]
  }
  if (g === 'half') {
    const [y, h] = key.split('-H').map(Number)
    return h === 1
      ? [dayjs(`${y}-01-01`), dayjs(`${y}-06-30`)]
      : [dayjs(`${y}-07-01`), dayjs(`${y}-12-31`)]
  }
  if (g === 'quarter') {
    const [y, q] = key.split('-Q').map(Number)
    const startMonth = (q - 1) * 3 + 1
    const start = dayjs(`${y}-${String(startMonth).padStart(2, '0')}-01`)
    const end = start.add(2, 'month').endOf('month')
    return [start, end]
  }
  if (g === 'month') {
    const start = dayjs(`${key}-01`)
    return [start, start.endOf('month')]
  }
  if (g === 'week') {
    // key 格式: "2025-W15"
    const [y, w] = key.split('-W').map(Number)
    const start = dayjs().year(y).isoWeek(w).startOf('isoWeek')
    return [start, start.endOf('isoWeek')]
  }
  // day
  return [dayjs(key), dayjs(key)]
}

function buildRange(g: Granularity, startKey: string, endKey: string): TimeRange {
  const [s] = keyToRange(startKey, g)
  const [, e] = keyToRange(endKey, g)
  const label = startKey === endKey
    ? formatKey(startKey, g)
    : `${formatKey(startKey, g)} — ${formatKey(endKey, g)}`
  return { granularity: g, startKey, endKey, label, startDate: s, endDate: e }
}

function formatKey(key: string, g: Granularity): string {
  if (g === 'year') return `${key}年`
  if (g === 'half') {
    const [y, h] = key.split('-H')
    return `${y}年${h === '1' ? '上' : '下'}半年`
  }
  if (g === 'quarter') {
    const [y, q] = key.split('-Q')
    return `${y}年Q${q}`
  }
  if (g === 'month') {
    const [y, m] = key.split('-')
    return `${y}年${parseInt(m)}月`
  }
  if (g === 'week') {
    const [y, w] = key.split('-W')
    return `${y}年第${w}周`
  }
  return key // day: "2025-04-14"
}

function sortKeys(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a]
}

// ─── 快捷选项 ───────────────────────────────────────────────
function getShortcuts(g: Granularity): Array<{ label: string; range: [string, string] }> {
  const now = dayjs()
  const y = now.year()
  const m = now.month() + 1
  const q = Math.ceil(m / 3)
  const w = now.isoWeek()

  if (g === 'year') return [
    { label: '今年', range: [`${y}`, `${y}`] },
    { label: '近2年', range: [`${y - 1}`, `${y}`] },
    { label: '近3年', range: [`${y - 2}`, `${y}`] },
  ]
  if (g === 'half') return [
    { label: '本半年', range: [`${y}-H${m <= 6 ? 1 : 2}`, `${y}-H${m <= 6 ? 1 : 2}`] },
    { label: '近两个半年', range: [`${m <= 6 ? y - 1 + '-H2' : y + '-H1'}`, `${y}-H${m <= 6 ? 1 : 2}`] },
  ]
  if (g === 'quarter') return [
    { label: '本季度', range: [`${y}-Q${q}`, `${y}-Q${q}`] },
    { label: '近两季度', range: [q > 1 ? `${y}-Q${q - 1}` : `${y - 1}-Q4`, `${y}-Q${q}`] },
    { label: '近四季度', range: [q > 0 ? `${y - 1}-Q${q === 4 ? 4 : q + 1 > 4 ? 1 : q}` : `${y - 1}-Q1`, `${y}-Q${q}`] },
  ]
  if (g === 'month') return [
    { label: '本月', range: [`${y}-${String(m).padStart(2, '0')}`, `${y}-${String(m).padStart(2, '0')}`] },
    { label: '近3个月', range: [now.subtract(2, 'month').format('YYYY-MM'), now.format('YYYY-MM')] },
    { label: '近6个月', range: [now.subtract(5, 'month').format('YYYY-MM'), now.format('YYYY-MM')] },
    { label: '近12个月', range: [now.subtract(11, 'month').format('YYYY-MM'), now.format('YYYY-MM')] },
  ]
  if (g === 'week') return [
    { label: '本周', range: [`${y}-W${String(w).padStart(2, '0')}`, `${y}-W${String(w).padStart(2, '0')}`] },
    { label: '上周', range: [`${now.subtract(1, 'week').year()}-W${String(now.subtract(1, 'week').isoWeek()).padStart(2, '0')}`, `${now.subtract(1, 'week').year()}-W${String(now.subtract(1, 'week').isoWeek()).padStart(2, '0')}`] },
    { label: '近三周', range: [`${now.subtract(2, 'week').year()}-W${String(now.subtract(2, 'week').isoWeek()).padStart(2, '0')}`, `${y}-W${String(w).padStart(2, '0')}`] },
  ]
  // day
  return [
    { label: '今天', range: [now.format('YYYY-MM-DD'), now.format('YYYY-MM-DD')] },
    { label: '近7天', range: [now.subtract(6, 'day').format('YYYY-MM-DD'), now.format('YYYY-MM-DD')] },
    { label: '近30天', range: [now.subtract(29, 'day').format('YYYY-MM-DD'), now.format('YYYY-MM-DD')] },
  ]
}

// ─── 子面板：年 ────────────────────────────────────────────
const YearPanel: React.FC<{ sel: string[]; onSelect: (k: string) => void }> = ({ sel, onSelect }) => {
  const years = [2024, 2025, 2026]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {years.map(y => {
        const k = String(y)
        const inRange = sel.length === 2 && k >= sel[0] && k <= sel[1]
        const isEdge = sel.includes(k)
        return (
          <Button
            key={k}
            size="small"
            type={isEdge ? 'primary' : inRange ? 'default' : 'default'}
            style={inRange && !isEdge ? { background: '#e6f4ff', borderColor: '#91caff' } : {}}
            onClick={() => onSelect(k)}
          >
            {y}年
          </Button>
        )
      })}
    </div>
  )
}

// ─── 子面板：半年度 ──────────────────────────────────────────
const HalfPanel: React.FC<{ sel: string[]; onSelect: (k: string) => void }> = ({ sel, onSelect }) => {
  const years = [2024, 2025, 2026]
  return (
    <div>
      {years.map(y => (
        <div key={y} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{y}年</div>
          <Space>
            {[1, 2].map(h => {
              const k = `${y}-H${h}`
              const inRange = sel.length === 2 && k >= sel[0] && k <= sel[1]
              const isEdge = sel.includes(k)
              return (
                <Button
                  key={k}
                  size="small"
                  type={isEdge ? 'primary' : 'default'}
                  style={inRange && !isEdge ? { background: '#e6f4ff', borderColor: '#91caff' } : {}}
                  onClick={() => onSelect(k)}
                >
                  {h === 1 ? '上半年' : '下半年'}
                </Button>
              )
            })}
          </Space>
        </div>
      ))}
    </div>
  )
}

// ─── 子面板：季度 ──────────────────────────────────────────
const QuarterPanel: React.FC<{ sel: string[]; onSelect: (k: string) => void }> = ({ sel, onSelect }) => {
  const years = [2024, 2025, 2026]
  return (
    <div>
      {years.map(y => (
        <div key={y} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>{y}年</div>
          <Space wrap>
            {[1, 2, 3, 4].map(q => {
              const k = `${y}-Q${q}`
              const inRange = sel.length === 2 && k >= sel[0] && k <= sel[1]
              const isEdge = sel.includes(k)
              return (
                <Button
                  key={k}
                  size="small"
                  type={isEdge ? 'primary' : 'default'}
                  style={inRange && !isEdge ? { background: '#e6f4ff', borderColor: '#91caff' } : {}}
                  onClick={() => onSelect(k)}
                >
                  Q{q}
                </Button>
              )
            })}
          </Space>
        </div>
      ))}
    </div>
  )
}

// ─── 子面板：月份 ──────────────────────────────────────────
const MonthPanel: React.FC<{ sel: string[]; onSelect: (k: string) => void }> = ({ sel, onSelect }) => {
  const [year, setYear] = useState(dayjs().year())
  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <Button size="small" icon={<LeftOutlined />} onClick={() => setYear(y => y - 1)} />
        <span style={{ minWidth: 60, textAlign: 'center', fontWeight: 500 }}>{year}年</span>
        <Button size="small" icon={<RightOutlined />} onClick={() => setYear(y => y + 1)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {months.map(m => {
          const k = `${year}-${String(m).padStart(2, '0')}`
          const inRange = sel.length === 2 && k >= sel[0] && k <= sel[1]
          const isEdge = sel.includes(k)
          return (
            <Button
              key={k}
              size="small"
              type={isEdge ? 'primary' : 'default'}
              style={inRange && !isEdge ? { background: '#e6f4ff', borderColor: '#91caff' } : {}}
              onClick={() => onSelect(k)}
            >
              {m}月
            </Button>
          )
        })}
      </div>
    </div>
  )
}

// ─── 子面板：周 ────────────────────────────────────────────
const WeekPanel: React.FC<{ sel: string[]; onSelect: (k: string) => void }> = ({ sel, onSelect }) => {
  const now = dayjs()
  const currentYear = now.year()
  const currentWeek = now.isoWeek()

  // 解析已选择的周 key，计算相对于当前的偏移
  function parseSelectedWeek(key: string) {
    const match = key.match(/(\d{4})-W(\d+)/)
    if (!match) return { year: currentYear, week: currentWeek }
    return { year: parseInt(match[1]), week: parseInt(match[2]) }
  }

  const { year: selYear, week: selWeek } = sel.length > 0 ? parseSelectedWeek(sel[0]) : { year: currentYear, week: currentWeek }

  // 计算总偏移量（以周为单位）
  const totalOffset = (selYear - currentYear) * 52 + (selWeek - currentWeek)

  const [offset, setOffset] = useState(totalOffset)
  const [yearOffset, setYearOffset] = useState(selYear - currentYear)

  // 当前显示的周
  const effectiveWeek = ((currentWeek - 1 + offset) % 52) + 1
  const effectiveYear = currentYear + yearOffset + Math.floor((currentWeek - 1 + offset) / 52)
  const k = `${effectiveYear}-W${String(effectiveWeek).padStart(2, '0')}`
  const start = dayjs().year(effectiveYear).isoWeek(effectiveWeek).startOf('isoWeek')
  const end = start.add(6, 'day')
  const label = `${start.format('MM/DD')} — ${end.format('MM/DD')}`
  const isEdge = sel.includes(k)
  const month = start.format('M月')

  function handlePrev() {
    const newOffset = offset - 1
    setOffset(newOffset)
    // 如果跨年，更新年偏移
    const newEffectiveWeek = ((currentWeek - 1 + newOffset) % 52) + 1
    if (newEffectiveWeek === 52 && effectiveWeek === 1) {
      setYearOffset(y => y - 1)
    }
  }

  function handleNext() {
    const newOffset = offset + 1
    setOffset(newOffset)
    // 如果跨年，更新年偏移
    const newEffectiveWeek = ((currentWeek - 1 + newOffset) % 52) + 1
    if (effectiveWeek === 52 && newEffectiveWeek === 1) {
      setYearOffset(y => y + 1)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Button size="small" icon={<LeftOutlined />} onClick={handlePrev} />
        <div style={{ textAlign: 'center', minWidth: 130 }}>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{effectiveYear}年 第{effectiveWeek}周</div>
          <div style={{ fontSize: 12, color: '#999' }}>{month} {label}</div>
        </div>
        <Button size="small" icon={<RightOutlined />} onClick={handleNext} />
      </div>
      <Button
        block
        type={isEdge ? 'primary' : 'default'}
        size="small"
        onClick={() => onSelect(k)}
        style={{ marginBottom: 6 }}
      >
        选择此周 ({label})
      </Button>
    </div>
  )
}

// ─── 子面板：天（双月日历区间选） ──────────────────────────
const DayPanel: React.FC<{ sel: string[]; onSelect: (k: string) => void }> = ({ sel, onSelect }) => {
  const [base, setBase] = useState(() => dayjs().startOf('month'))
  const next = base.add(1, 'month')

  function renderCal(month: Dayjs) {
    const firstDay = month.startOf('month').day()
    const daysInMonth = month.daysInMonth()
    const cells: React.ReactNode[] = []

    // 空格占位
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`e-${i}`} />)
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const k = month.date(d).format('YYYY-MM-DD')
      const isToday = k === dayjs().format('YYYY-MM-DD')
      const inRange = sel.length === 2 && k >= sel[0] && k <= sel[1]
      const isEdge = sel.includes(k)
      let bg = 'transparent'
      let color = 'inherit'
      let border = isToday ? '1px solid #1677ff' : '1px solid transparent'
      if (isEdge) { bg = '#1677ff'; color = '#fff'; border = '1px solid #1677ff' }
      else if (inRange) { bg = '#e6f4ff'; border = '1px solid #91caff' }

      cells.push(
        <div
          key={k}
          onClick={() => onSelect(k)}
          style={{
            width: 28, height: 28, lineHeight: '26px', textAlign: 'center',
            borderRadius: 4, fontSize: 12, cursor: 'pointer',
            background: bg, color, border,
            transition: 'all .1s',
          }}
          onMouseEnter={e => { if (!isEdge && !inRange) (e.currentTarget as HTMLElement).style.background = '#f5f5f5' }}
          onMouseLeave={e => { if (!isEdge && !inRange) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
        >
          {d}
        </div>
      )
    }
    return cells
  }

  const dayNames = ['日', '一', '二', '三', '四', '五', '六']

  return (
    <div>
      <div style={{ display: 'flex', gap: 20 }}>
        {[base, next].map((month, idx) => (
          <div key={idx}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 6 }}>
              {idx === 0 && (
                <Button size="small" icon={<LeftOutlined />} onClick={() => setBase(b => b.subtract(1, 'month'))} />
              )}
              <span style={{ flex: 1, textAlign: 'center', fontWeight: 500, fontSize: 13 }}>
                {month.format('YYYY年M月')}
              </span>
              {idx === 1 && (
                <Button size="small" icon={<RightOutlined />} onClick={() => setBase(b => b.add(1, 'month'))} />
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 28px)', gap: 2 }}>
              {dayNames.map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#999', height: 24, lineHeight: '24px' }}>{d}</div>
              ))}
              {renderCal(month)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── 主组件 ───────────────────────────────────────────────
const TimeGranularityPicker: React.FC<Props> = ({
  value,
  onChange,
  defaultGranularity = 'month',
}) => {
  const [open, setOpen] = useState(false)
  const [grain, setGrain] = useState<Granularity>(value?.granularity ?? defaultGranularity)
  const [sel, setSel] = useState<string[]>(() => {
    if (value) return [value.startKey, value.endKey]
    return []
  })
  const [customWeekVal, setCustomWeekVal] = useState<number>(4)
  const now = dayjs()

  // 点击 cell / day / week 的统一处理
  function handleSelect(k: string) {
    if (grain === 'week') {
      // 周：单选，直接确认
      const range = buildRange(grain, k, k)
      setSel([k, k])
      onChange?.(range)
      return
    }
    setSel(prev => {
      if (prev.length === 0) return [k]
      if (prev.length === 1) {
        const [s, e] = sortKeys(prev[0], k)
        return [s, e]
      }
      return [k]
    })
  }

  function handleConfirm() {
    if (sel.length === 0) return
    const [s, e] = sel.length === 2 ? [sel[0], sel[1]] : [sel[0], sel[0]]
    onChange?.(buildRange(grain, s, e))
    setOpen(false)
  }

  function handleGrainChange(g: Granularity) {
    setGrain(g)
    setSel([])
  }

  const shortcuts = getShortcuts(grain)
  const displayLabel = value ? value.label : '请选择时间范围'

  const panelContent = (
    <div style={{ padding: 16, width: grain === 'day' ? 560 : 320, background: '#fff', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,.12)', border: '1px solid #f0f0f0' }}>
      {/* 颗粒度切换 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>时间颗粒度</div>
        <Space size={4} wrap>
          {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map(g => (
            <Button
              key={g}
              size="small"
              type={grain === g ? 'primary' : 'default'}
              onClick={() => handleGrainChange(g)}
            >
              {GRANULARITY_LABELS[g]}
            </Button>
          ))}
        </Space>
      </div>

      {/* 快捷选项 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 6 }}>快捷选择</div>
        <Space size={4} wrap>
          {shortcuts.map(s => (
            <Button
              key={s.label}
              size="small"
              onClick={() => {
                setSel(s.range)
                onChange?.(buildRange(grain, s.range[0], s.range[1]))
              }}
            >
              {s.label}
            </Button>
          ))}
        </Space>
        {/* 近N周 自定义输入 */}
        {grain === 'week' && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#666' }}>近</span>
            <InputNumber
              size="small"
              min={1}
              max={24}
              value={customWeekVal}
              style={{ width: 52 }}
              onChange={val => setCustomWeekVal(val ?? 4)}
              onPressEnter={() => {
                const curYear = now.year()
                const curWeek = now.isoWeek()
                const startWeek = now.subtract(customWeekVal - 1, 'week')
                const range = [
                  `${startWeek.year()}-W${String(startWeek.isoWeek()).padStart(2, '0')}`,
                  `${curYear}-W${String(curWeek).padStart(2, '0')}`,
                ]
                setSel(range)
                onChange?.(buildRange(grain, range[0], range[1]))
              }}
            />
            <span style={{ fontSize: 12, color: '#666' }}>周</span>
            <Button
              size="small"
              type="primary"
              onClick={() => {
                const curYear = now.year()
                const curWeek = now.isoWeek()
                const startWeek = now.subtract(customWeekVal - 1, 'week')
                const range = [
                  `${startWeek.year()}-W${String(startWeek.isoWeek()).padStart(2, '0')}`,
                  `${curYear}-W${String(curWeek).padStart(2, '0')}`,
                ]
                setSel(range)
                onChange?.(buildRange(grain, range[0], range[1]))
              }}
            >
              确认
            </Button>
          </div>
        )}
      </div>

      {/* 分割线 */}
      <div style={{ borderTop: '1px solid #f0f0f0', margin: '10px 0' }} />

      {/* 选择面板 */}
      {grain === 'year' && <YearPanel sel={sel} onSelect={handleSelect} />}
      {grain === 'half' && <HalfPanel sel={sel} onSelect={handleSelect} />}
      {grain === 'quarter' && <QuarterPanel sel={sel} onSelect={handleSelect} />}
      {grain === 'month' && <MonthPanel sel={sel} onSelect={handleSelect} />}
      {grain === 'week' && <WeekPanel sel={sel} onSelect={handleSelect} />}
      {grain === 'day' && <DayPanel sel={sel} onSelect={handleSelect} />}

      {/* 当前选中 + 确认 */}
      {grain !== 'week' && (
        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            {sel.length === 0 && '请点击选择'}
            {sel.length === 1 && `已选起点：${formatKey(sel[0], grain)}，再选终点`}
            {sel.length === 2 && `${formatKey(sel[0], grain)} — ${formatKey(sel[1], grain)}`}
          </span>
          <Button
            size="small"
            type="primary"
            disabled={sel.length === 0}
            onClick={handleConfirm}
          >
            确认
          </Button>
        </div>
      )}
    </div>
  )

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <Tooltip title={value?.label} placement="top">
        <Button
          onClick={() => setOpen(o => !o)}
          style={{ minWidth: 200, textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayLabel}
          </span>
          {value && (
            <Tag color="blue" style={{ marginLeft: 6, flexShrink: 0, fontSize: 11 }}>
              {GRANULARITY_LABELS[value.granularity]}
            </Tag>
          )}
        </Button>
      </Tooltip>

      {open && (
        <>
          {/* 遮罩层 */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setOpen(false)}
          />
          {/* 浮层 */}
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 1000 }}>
            {panelContent}
          </div>
        </>
      )}
    </div>
  )
}

export default TimeGranularityPicker

// ─── 使用示例 ──────────────────────────────────────────────
// import TimeGranularityPicker, { TimeRange } from './TimeGranularityPicker'
//
// function Demo() {
//   const [range, setRange] = useState<TimeRange>()
//   return (
//     <TimeGranularityPicker
//       defaultGranularity="month"
//       value={range}
//       onChange={r => {
//         setRange(r)
//         console.log('startDate:', r.startDate.format('YYYY-MM-DD'))
//         console.log('endDate:  ', r.endDate.format('YYYY-MM-DD'))
//       }}
//     />
//   )
// }
