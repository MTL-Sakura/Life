import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlarmClock,
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Dumbbell,
  Download,
  Eye,
  EyeOff,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  Pencil,
  Repeat2,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  TimerReset,
  Trash2,
  TrendingUp,
  Upload,
  User,
  X,
} from 'lucide-react'
import { api } from './api'
import { initialHabits, initialTasks, projects as initialProjects, weekDays } from './mockData'
import type { AiPlan, BootstrapData, Category, Habit, PageKey, PlanImportBatch, PlanImportCounts, PlanImportDocument, Project, ReviewSummary, Subtask, Task, UserSettings } from './types'

const navigation = [
  { key: 'today' as const, label: '今日', icon: LayoutDashboard },
  { key: 'inbox' as const, label: '收集箱', icon: Inbox },
  { key: 'calendar' as const, label: '日历', icon: CalendarDays },
  { key: 'projects' as const, label: '项目', icon: FolderKanban },
  { key: 'habits' as const, label: '习惯', icon: Target },
  { key: 'review' as const, label: '回顾', icon: BarChart3 },
]

const pageNames: Record<PageKey, string> = {
  today: '今日',
  inbox: '收集箱',
  calendar: '日历',
  projects: '项目',
  habits: '习惯',
  review: '回顾',
  settings: '设置',
}

const priorityLabels = { high: '高', medium: '中', low: '低' }

const defaultSettings: UserSettings = {
  displayName: 'Sakura',
  email: '',
  timezone: 'Europe/Berlin',
  emailReminders: true,
  dailySummary: true,
  dailySummaryTime: '21:30:00',
  overdueReminder: false,
  taskReminderMinutes: 10,
  weekStartsOn: 'monday',
}

const defaultReview: ReviewSummary = {
  total: 0,
  completed: 0,
  completionRate: 0,
  completedMinutes: 0,
  overdue: 0,
}

const palette = ['#496d5b', '#b96552', '#58748f', '#a1843e', '#7a6b87']

type TaskSubtaskDraft = Partial<Subtask> & { title: string }

type TaskDraft = Omit<Partial<Task>, 'subtasks'> & {
  title: string
  subtasks?: TaskSubtaskDraft[]
}

type EditorState =
  | { type: 'task'; taskId?: number; schedule?: boolean }
  | { type: 'project' }
  | { type: 'habit' }
  | null

type SettingsSectionKey = 'account' | 'reminders' | 'schedule' | 'data'

const settingsSections: Array<{ key: SettingsSectionKey; label: string; icon: typeof User }> = [
  { key: 'account', label: '账户', icon: User },
  { key: 'reminders', label: '提醒', icon: Bell },
  { key: 'schedule', label: '日程', icon: CalendarRange },
  { key: 'data', label: '数据', icon: Archive },
]

function routeFromLocation(): { page: PageKey; settingsSection: SettingsSectionKey } {
  const parts = window.location.pathname.split('/').filter(Boolean)
  const page = parts[0]
  const validPages: PageKey[] = ['today', 'inbox', 'calendar', 'projects', 'habits', 'review', 'settings']
  const settingsSection = settingsSections.some(({ key }) => key === parts[1])
    ? parts[1] as SettingsSectionKey
    : 'account'

  if (page === 'settings') return { page: 'settings', settingsSection }
  if (validPages.includes(page as PageKey)) return { page: page as PageKey, settingsSection: 'account' }
  return { page: 'today', settingsSection: 'account' }
}

function pathForPage(page: PageKey, settingsSection: SettingsSectionKey = 'account') {
  if (page === 'today') return '/'
  if (page === 'settings') return `/settings/${settingsSection}`
  return `/${page}`
}

function berlinDate() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Berlin',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())
}

type DashboardNotification = {
  key: string
  taskId: number
  title: string
  detail: string
  tone: 'overdue' | 'upcoming' | 'due'
  timestamp: number
}

function notificationTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Berlin',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function taskNotifications(tasks: Task[]): DashboardNotification[] {
  const now = Date.now()
  const sixHours = 6 * 60 * 60 * 1000
  const oneDay = 24 * 60 * 60 * 1000

  return tasks.flatMap((task): DashboardNotification[] => {
    if (task.completed || task.status === 'cancelled') return []
    if (task.dueAt) {
      const due = new Date(task.dueAt).getTime()
      if (Number.isFinite(due) && due < now) {
        return [{ key: `overdue-${task.id}-${task.dueAt}`, taskId: task.id, title: task.title, detail: `已逾期 · ${notificationTime(task.dueAt)}`, tone: 'overdue', timestamp: due }]
      }
    }
    if (task.startAt) {
      const start = new Date(task.startAt).getTime()
      if (Number.isFinite(start) && start >= now && start - now <= sixHours) {
        return [{ key: `upcoming-${task.id}-${task.startAt}`, taskId: task.id, title: task.title, detail: `即将开始 · ${notificationTime(task.startAt)}`, tone: 'upcoming', timestamp: start }]
      }
    }
    if (task.dueAt) {
      const due = new Date(task.dueAt).getTime()
      if (Number.isFinite(due) && due >= now && due - now <= oneDay) {
        return [{ key: `due-${task.id}-${task.dueAt}`, taskId: task.id, title: task.title, detail: `即将到期 · ${notificationTime(task.dueAt)}`, tone: 'due', timestamp: due }]
      }
    }
    return []
  }).sort((left, right) => {
    const weights = { overdue: 0, upcoming: 1, due: 2 }
    return weights[left.tone] - weights[right.tone] || left.timestamp - right.timestamp
  }).slice(0, 6)
}

function parsePlanImportJson(value: string): PlanImportDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('JSON 格式不正确，请检查括号、逗号和引号。')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON 顶层必须是一个对象。')
  const plan = parsed as Partial<PlanImportDocument>
  if (plan.schemaVersion !== 1) throw new Error('目前只支持 schemaVersion 1。')
  if (typeof plan.importKey !== 'string' || !plan.importKey.trim()) throw new Error('JSON 缺少 importKey。')
  for (const key of ['categories', 'projects', 'habits', 'tasks'] as const) {
    if (plan[key] !== undefined && !Array.isArray(plan[key])) throw new Error(`${key} 必须是数组。`)
  }
  const total = (plan.projects?.length ?? 0) + (plan.habits?.length ?? 0) + (plan.tasks?.length ?? 0)
  if (total === 0) throw new Error('JSON 中没有可以导入的项目、习惯或任务。')
  return plan as PlanImportDocument
}

function planStartDateLabel(value?: string) {
  if (!value || value === 'tomorrow') return '明天'
  if (value === 'today') return '今天'
  return value
}

function currentWeekDates() {
  return Array.from({ length: 7 }, (_, index) => Number(currentWeekDateIso(index).slice(8, 10)))
}

function currentWeekDateIso(dayIndex: number) {
  const [year, month, day] = berlinIsoDate().split('-').map(Number)
  const today = new Date(Date.UTC(year, month - 1, day, 12))
  const mondayOffset = (today.getUTCDay() + 6) % 7
  today.setUTCDate(today.getUTCDate() - mondayOffset + dayIndex)
  return `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
}

function berlinIsoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function shiftIsoDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days, 12))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

function localDateTime(date: string, minutes: number) {
  const shiftedDays = Math.floor(minutes / (24 * 60))
  const timeMinutes = minutes % (24 * 60)
  const hour = Math.floor(timeMinutes / 60)
  const minute = timeMinutes % 60
  return `${shiftIsoDate(date, shiftedDays)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
}

function currentMonthCells() {
  const [year, month, today] = berlinIsoDate().split('-').map(Number)
  const leadingDays = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - leadingDays + 1
    if (day < 1 || day > daysInMonth) return { key: `blank-${index}`, day: null, date: null, active: false }
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return { key: date, day, date, active: day === today }
  })
}

function taskCalendarDate(task: Task) {
  if (task.startAt) return task.startAt.slice(0, 10)
  if (task.start && !task.unscheduled) return berlinIsoDate()
  return null
}

function taskCalendarTime(task: Task) {
  return task.startAt?.slice(11, 16) ?? task.start ?? null
}

type CalendarOccurrence = {
  key: string
  task: Task
  date: string
  time: string | null
  endTime: string | null
  projected: boolean
}

function isoDateDifference(left: string, right: string) {
  const toUtc = (value: string) => {
    const [year, month, day] = value.split('-').map(Number)
    return Date.UTC(year, month - 1, day, 12)
  }
  return Math.round((toUtc(right) - toUtc(left)) / 86_400_000)
}

function taskRepeatsOnDate(task: Task, date: string) {
  const startDate = taskCalendarDate(task)
  if (!startDate || !task.recurrenceRule || date <= startDate) return false
  const difference = isoDateDifference(startDate, date)
  if (task.recurrenceRule.startsWith('FREQ=DAILY')) return difference > 0
  if (task.recurrenceRule.startsWith('FREQ=WEEKLY')) return difference > 0 && difference % 7 === 0
  if (task.recurrenceRule.startsWith('FREQ=MONTHLY')) return date.slice(8, 10) === startDate.slice(8, 10)
  return false
}

function calendarOccurrences(tasks: Task[], dates: string[]) {
  const scheduledTasks = tasks.filter((task) => !task.unscheduled && taskCalendarDate(task))
  const occurrences: CalendarOccurrence[] = scheduledTasks.map((task) => ({
    key: `task-${task.id}`,
    task,
    date: taskCalendarDate(task) as string,
    time: taskCalendarTime(task),
    endTime: task.endAt?.slice(11, 16) ?? task.end ?? null,
    projected: false,
  }))
  const parentIds = new Set(tasks.map((task) => task.recurrenceSourceTaskId).filter((id): id is number => typeof id === 'number'))
  const leaves = scheduledTasks.filter((task) => task.recurrenceRule && !parentIds.has(task.id))
  for (const task of leaves) {
    for (const date of dates) {
      if (!taskRepeatsOnDate(task, date)) continue
      occurrences.push({
        key: `repeat-${task.id}-${date}`,
        task,
        date,
        time: taskCalendarTime(task),
        endTime: task.endAt?.slice(11, 16) ?? task.end ?? null,
        projected: true,
      })
    }
  }
  return occurrences
}

function taskReviewDate(task: Task) {
  return task.startAt?.slice(0, 10)
    ?? task.dueAt?.slice(0, 10)
    ?? task.completedAt?.slice(0, 10)
    ?? (task.start && !task.unscheduled ? berlinIsoDate() : null)
    ?? null
}

function recurrenceLabel(rule?: string | null) {
  if (rule?.startsWith('FREQ=DAILY')) return '每天'
  if (rule?.startsWith('FREQ=WEEKLY')) return '每周'
  if (rule?.startsWith('FREQ=MONTHLY')) return '每月'
  return '不重复'
}

function taskMoment(value?: string | null) {
  if (!value) return '待安排'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Berlin',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function taskScheduleLabel(task: Task) {
  if (task.startAt) return taskMoment(task.startAt)
  if (task.start) return `今天 ${task.start}`
  return '待安排'
}

function ProgressBar({ value, color = '#496d5b' }: { value: number; color?: string }) {
  return (
    <div className="progress-track" aria-label={`进度 ${value}%`}>
      <span style={{ width: `${value}%`, backgroundColor: color }} />
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      className={`switch ${checked ? 'is-on' : ''}`}
      aria-label={checked ? '关闭' : '开启'}
      aria-pressed={checked}
      onClick={onChange}
    >
      <span />
    </button>
  )
}

function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </header>
        {children}
      </section>
    </div>
  )
}

function aiPlanDateLabel(startAt: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Berlin',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(startAt))
}

function aiPlanTimeLabel(startAt: string, endAt: string) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return `${formatter.format(new Date(startAt))}–${formatter.format(new Date(endAt))}`
}

function AiPlannerModal({ plan, loading, applying, error, onClose, onRetry, onApply }: {
  plan: AiPlan | null
  loading: boolean
  applying: boolean
  error: string
  onClose: () => void
  onRetry: () => void
  onApply: () => void
}) {
  return (
    <ModalShell title="AI 日程建议" eyebrow="SMART PLAN" onClose={onClose}>
      <div className="ai-plan-body">
        {loading && (
          <div className="ai-plan-loading" role="status">
            <span className="ai-plan-spinner"><Sparkles size={24} /></span>
            <strong>正在整理接下来一周</strong>
            <p>会避开现有安排，并检查每项任务的预计时长。</p>
          </div>
        )}

        {!loading && error && (
          <div className="ai-plan-error">
            <span><X size={19} /></span>
            <div><strong>没有生成日程建议</strong><p>{error}</p></div>
          </div>
        )}

        {!loading && plan && (
          <>
            <div className="ai-plan-summary">
              <Sparkles size={19} />
              <div><strong>{plan.summary}</strong><span>今天还可以生成 {plan.remainingUses} 次新建议</span></div>
            </div>
            <div className="ai-plan-list">
              {plan.items.map((item) => (
                <article className="ai-plan-item" key={item.taskId}>
                  <div className="ai-plan-time"><strong>{aiPlanDateLabel(item.startAt)}</strong><span>{aiPlanTimeLabel(item.startAt, item.endAt)}</span></div>
                  <span className={`priority priority-${item.priority}`}>{priorityLabels[item.priority]}</span>
                  <div className="ai-plan-copy"><strong>{item.title}</strong><p>{item.reason}</p><small>{item.duration} 分钟</small></div>
                </article>
              ))}
            </div>
            {plan.skipped.length > 0 && (
              <details className="ai-plan-skipped">
                <summary>暂未安排 {plan.skipped.length} 项</summary>
                {plan.skipped.map((item) => <p key={item.taskId}><strong>{item.title}</strong><span>{item.reason}</span></p>)}
              </details>
            )}
          </>
        )}
      </div>
      <footer className="modal-actions">
        <button type="button" className="outline-button" onClick={onClose}>{plan ? '暂不采用' : '关闭'}</button>
        {error && <button type="button" className="primary-button" onClick={onRetry}>重新生成</button>}
        {plan && <button type="button" className="primary-button" onClick={onApply} disabled={applying}>{applying ? '写入中…' : `采用这 ${plan.items.length} 项安排`}</button>}
      </footer>
    </ModalShell>
  )
}

function TaskEditor({ task, schedule = false, projects, categories, defaultReminderMinutes, onClose, onSave }: {
  task?: Task
  schedule?: boolean
  projects: Project[]
  categories: Category[]
  defaultReminderMinutes: number
  onClose: () => void
  onSave: (task: TaskDraft) => Promise<void>
}) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const matchingProject = task && !task.projectId
    ? projects.find((project) => project.title.includes(task.project) || task.project.includes(project.title))
    : undefined
  const matchingCategory = task && !task.categoryId
    ? categories.find((category) => category.name === task.category)
    : undefined
  const [projectId, setProjectId] = useState(task?.projectId ? String(task.projectId) : matchingProject ? String(matchingProject.id) : '')
  const [categoryId, setCategoryId] = useState(task?.categoryId ? String(task.categoryId) : matchingCategory ? String(matchingCategory.id) : '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(task?.priority ?? 'medium')
  const [date, setDate] = useState(task?.startAt?.slice(0, 10) ?? (task?.start || schedule ? berlinIsoDate() : ''))
  const [startTime, setStartTime] = useState(task?.startAt?.slice(11, 16) ?? task?.start ?? '09:00')
  const [endTime, setEndTime] = useState(task?.endAt?.slice(11, 16) ?? task?.end ?? '10:00')
  const [dueAt, setDueAt] = useState(task?.dueAt?.slice(0, 16) ?? '')
  const [duration, setDuration] = useState(task?.duration ?? 30)
  const [recurrenceRule, setRecurrenceRule] = useState(task?.recurrenceRule ?? '')
  const [reminderMinutes, setReminderMinutes] = useState(task?.reminderMinutes ?? defaultReminderMinutes)
  const [subtasks, setSubtasks] = useState<Array<TaskSubtaskDraft & { clientId: string }>>(() =>
    (task?.subtasks ?? []).map((subtask) => ({ ...subtask, clientId: `saved-${subtask.id}` }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function addSubtask() {
    setSubtasks((current) => [...current, { title: '', completed: false, clientId: `new-${Date.now()}` }])
  }

  function updateSubtask(clientId: string, title: string) {
    setSubtasks((current) => current.map((subtask) => subtask.clientId === clientId ? { ...subtask, title } : subtask))
  }

  function removeSubtask(clientId: string) {
    setSubtasks((current) => current.filter((subtask) => subtask.clientId !== clientId))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    setError('')
    try {
      await onSave({
        id: task?.id,
        title: title.trim(),
        notes: notes.trim(),
        projectId: projectId ? Number(projectId) : null,
        categoryId: categoryId ? Number(categoryId) : null,
        priority,
        duration,
        startAt: date ? `${date}T${startTime}:00` : null,
        endAt: date ? `${date}T${endTime}:00` : null,
        dueAt: dueAt || null,
        recurrenceRule: date ? recurrenceRule || null : null,
        reminderMinutes: date ? reminderMinutes : null,
        subtasks: subtasks
          .map(({ id, title: subtaskTitle, completed }) => ({ id, title: subtaskTitle.trim(), completed: Boolean(completed) }))
          .filter((subtask) => subtask.title),
      })
      onClose()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '任务保存失败，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title={schedule ? '安排任务' : task ? '编辑任务' : '新建任务'} eyebrow="TASK" onClose={onClose}>
      <form className="editor-form" onSubmit={submit}>
        <label className="full"><span>任务名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="要完成什么？" /></label>
        <label className="full"><span>备注</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="补充背景或完成标准" /></label>
        <div className="editor-grid">
          <label><span>所属项目</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">无项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.title}</option>)}</select></label>
          <label><span>分类</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">收集箱</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          <label><span>优先级</span><select value={priority} onChange={(event) => setPriority(event.target.value as 'low' | 'medium' | 'high')}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
          <label><span>预计时长（分钟）</span><input type="number" min="1" max="1440" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
          <label><span>安排日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <div className="time-pair"><label><span>开始</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} disabled={!date} /></label><label><span>结束</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={!date} /></label></div>
          <label><span>截止时间</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          <label><span>重复</span><select value={recurrenceRule} onChange={(event) => setRecurrenceRule(event.target.value)} disabled={!date}><option value="">不重复</option><option value="FREQ=DAILY">每天</option><option value="FREQ=WEEKLY">每周</option><option value="FREQ=MONTHLY">每月</option></select></label>
          <label><span>提前提醒（分钟）</span><input type="number" min="0" max="10080" value={reminderMinutes} onChange={(event) => setReminderMinutes(Number(event.target.value))} disabled={!date} /></label>
          <fieldset className="subtask-editor full">
            <legend>子任务</legend>
            <div className="subtask-editor-list">
              {subtasks.map((subtask, index) => (
                <div className="subtask-editor-row" key={subtask.clientId}>
                  <span>{index + 1}</span>
                  <input value={subtask.title} onChange={(event) => updateSubtask(subtask.clientId, event.target.value)} placeholder="下一小步" />
                  <button type="button" className="icon-button" onClick={() => removeSubtask(subtask.clientId)} aria-label="删除子任务" title="删除子任务"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <button type="button" className="text-button subtask-add" onClick={addSubtask}><Plus size={15} /> 添加子任务</button>
          </fieldset>
        </div>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving || !title.trim()}>{saving ? '保存中…' : schedule ? '加入日程' : task ? '保存修改' : '保存任务'}</button></footer>
      </form>
    </ModalShell>
  )
}

function TaskDetail({ task, onClose, onEdit, onSchedule, onDelete, onToggle, onToggleSubtask }: {
  task: Task
  onClose: () => void
  onEdit: () => void
  onSchedule: () => void
  onDelete: () => Promise<void>
  onToggle: () => void
  onToggleSubtask: (subtask: Subtask) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <ModalShell title={task.title} eyebrow="TASK DETAIL" onClose={onClose}>
      <div className="task-detail">
        <div className={`task-detail-status ${task.completed ? 'is-complete' : ''}`}>
          <TaskCheck task={task} onToggle={onToggle} />
          <button type="button" onClick={onToggle}><strong>{task.completed ? '已完成' : '标记为完成'}</strong><small>{task.completed ? '再次点击可恢复任务' : '完成后会保留这次记录'}</small></button>
        </div>

        <div className="task-detail-meta">
          <div><CalendarClock size={17} /><span>时间</span><strong>{taskScheduleLabel(task)}</strong></div>
          <div><Clock3 size={17} /><span>预计</span><strong>{task.duration} 分钟</strong></div>
          <div><FolderKanban size={17} /><span>项目</span><strong>{task.project}</strong></div>
          <div><Repeat2 size={17} /><span>重复</span><strong>{recurrenceLabel(task.recurrenceRule)}</strong></div>
        </div>

        {task.notes && <section className="task-detail-section"><h3>备注</h3><p>{task.notes}</p></section>}

        <section className="task-detail-section">
          <div className="task-detail-heading"><h3>子任务</h3><span>{(task.subtasks ?? []).filter((subtask) => subtask.completed).length}/{task.subtasks?.length ?? 0}</span></div>
          {(task.subtasks ?? []).length > 0 ? (
            <div className="subtask-list">
              {(task.subtasks ?? []).map((subtask) => (
                <button type="button" className={subtask.completed ? 'is-complete' : ''} onClick={() => onToggleSubtask(subtask)} key={subtask.id}>
                  <span className="subtask-check">{subtask.completed && <Check size={13} />}</span>
                  <span>{subtask.title}</span>
                </button>
              ))}
            </div>
          ) : <p className="empty-copy">这个任务还没有拆分步骤。</p>}
        </section>

        {confirmDelete && (
          <div className="delete-confirm" role="alert">
            <div><strong>删除这个任务？</strong><span>任务和子任务都会被永久删除。</span></div>
            <button type="button" className="outline-button" onClick={() => setConfirmDelete(false)}>取消</button>
            <button type="button" className="danger-button" onClick={remove} disabled={deleting}>{deleting ? '删除中…' : '确认删除'}</button>
          </div>
        )}

        <footer className="task-detail-actions">
          <button type="button" className="icon-button task-delete-button" onClick={() => setConfirmDelete(true)} aria-label="删除任务" title="删除任务"><Trash2 size={17} /></button>
          {task.unscheduled && <button type="button" className="outline-button" onClick={onSchedule}><CalendarClock size={16} /> 安排时间</button>}
          <button type="button" className="primary-button" onClick={onEdit}><Pencil size={16} /> 编辑任务</button>
        </footer>
      </div>
    </ModalShell>
  )
}

function ProjectEditor({ onClose, onSave }: { onClose: () => void; onSave: (project: Partial<Project> & { title: string }) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [area, setArea] = useState('个人成长')
  const [color, setColor] = useState(palette[0])
  const [dueAt, setDueAt] = useState('')
  const [stages, setStages] = useState('确定范围\n完成第一阶段\n完成第二阶段\n项目复盘')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const stageList = stages.split('\n').map((item) => item.trim()).filter(Boolean)
      await onSave({ title: title.trim(), description: description.trim(), area, color, dueAt: dueAt ? `${dueAt}T23:59:00` : null, stages: stageList, currentStage: stageList[0] ?? '确定下一步' })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="新建项目" eyebrow="PROJECT" onClose={onClose}>
      <form className="editor-form" onSubmit={submit}>
        <label><span>项目名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：完成德语 B1" /></label>
        <label><span>项目说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="editor-grid">
          <label><span>生活领域</span><input value={area} onChange={(event) => setArea(event.target.value)} /></label>
          <label><span>目标日期</span><input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          <fieldset className="color-field full"><legend>颜色</legend><div className="color-swatches">{palette.map((item) => <button type="button" className={color === item ? 'active' : ''} style={{ backgroundColor: item }} onClick={() => setColor(item)} aria-label={`选择颜色 ${item}`} key={item} />)}</div></fieldset>
          <label className="full"><span>项目阶段</span><textarea value={stages} onChange={(event) => setStages(event.target.value)} /></label>
        </div>
        <footer className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving || !title.trim()}>{saving ? '保存中…' : '创建项目'}</button></footer>
      </form>
    </ModalShell>
  )
}

function HabitEditor({ onClose, onSave }: { onClose: () => void; onSave: (habit: Partial<Habit> & { name: string }) => Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [frequencyType, setFrequencyType] = useState<'daily' | 'weekly' | 'custom'>('daily')
  const [targetCount, setTargetCount] = useState(1)
  const [scheduleDays, setScheduleDays] = useState([1, 2, 3, 4, 5, 6, 7])
  const [color, setColor] = useState(palette[0])
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), description: description.trim(), frequencyType, targetCount, scheduleDays, color, allowMakeup: true })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(day: number) {
    setScheduleDays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort())
  }

  return (
    <ModalShell title="新建习惯" eyebrow="HABIT" onClose={onClose}>
      <form className="editor-form" onSubmit={submit}>
        <label><span>习惯名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：晚饭后散步" /></label>
        <label><span>目标说明</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：20 分钟" /></label>
        <div className="editor-grid">
          <label><span>频率</span><select value={frequencyType} onChange={(event) => setFrequencyType(event.target.value as 'daily' | 'weekly' | 'custom')}><option value="daily">每天</option><option value="weekly">每周目标次数</option><option value="custom">指定星期</option></select></label>
          <label><span>每周目标次数</span><input type="number" min="1" max="7" value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} /></label>
          <fieldset className="color-field full"><legend>进行日</legend><div className="day-selector">{weekDays.map((day, index) => <button type="button" className={scheduleDays.includes(index + 1) ? 'active' : ''} onClick={() => toggleDay(index + 1)} key={day}>周{day}</button>)}</div></fieldset>
          <fieldset className="color-field full"><legend>颜色</legend><div className="color-swatches">{palette.map((item) => <button type="button" className={color === item ? 'active' : ''} style={{ backgroundColor: item }} onClick={() => setColor(item)} aria-label={`选择颜色 ${item}`} key={item} />)}</div></fieldset>
        </div>
        <footer className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving || !name.trim()}>{saving ? '保存中…' : '创建习惯'}</button></footer>
      </form>
    </ModalShell>
  )
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('sakura')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onLogin(username, password)
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark large"><span>行</span></div>
        <p className="eyebrow">LIFE DASHBOARD</p>
        <h1>人生看板</h1>
        <p className="login-date">{berlinDate()} · 柏林</p>
        <form onSubmit={submit} className="login-form">
          <label>
            <span>用户名</span>
            <div className="field-with-icon">
              <User size={17} />
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </div>
          </label>
          <label>
            <span>密码</span>
            <div className="field-with-icon">
              <LockKeyhole size={17} />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
              <button type="button" className="field-action" onClick={() => setShowPassword((value) => !value)} aria-label="显示或隐藏密码">
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button login-button" type="submit" disabled={submitting || !username.trim() || !password}>
            {submitting ? '登录中…' : '登录'}
            <ChevronRight size={17} />
          </button>
        </form>
      </section>
      <section className="login-quote">
        <span className="quote-line" />
        <p>今天不需要完美，只需要向前一点。</p>
      </section>
    </main>
  )
}

function Sidebar({ page, setPage, inboxCount, displayName }: { page: PageKey; setPage: (page: PageKey) => void; inboxCount: number; displayName: string }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><span>行</span></div>
        <div>
          <strong>人生看板</strong>
          <span>Life Dashboard</span>
        </div>
      </div>
      <nav className="main-nav" aria-label="主导航">
        {navigation.map(({ key, label, icon: Icon }) => (
          <button key={key} className={page === key ? 'active' : ''} onClick={() => setPage(key)}>
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {key === 'inbox' && inboxCount > 0 && <small>{inboxCount}</small>}
          </button>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button className={page === 'settings' ? 'active' : ''} onClick={() => setPage('settings')}>
          <Settings size={18} strokeWidth={1.8} />
          <span>设置</span>
        </button>
        <div className="profile-chip">
          <div className="avatar">{displayName.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{displayName}</strong>
            <span>柏林时间</span>
          </div>
          <MoreHorizontal size={17} />
        </div>
      </div>
    </aside>
  )
}

function Topbar({ page, tasks, onMenu, onOpenTask, onOpenReminderSettings }: {
  page: PageKey
  tasks: Task[]
  onMenu: () => void
  onOpenTask: (taskId: number) => void
  onOpenReminderSettings: () => void
}) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const notificationRef = useRef<HTMLDivElement>(null)
  const notifications = useMemo(() => taskNotifications(tasks), [tasks])

  useEffect(() => {
    if (!notificationsOpen) return
    function closeOnOutside(event: PointerEvent) {
      if (!notificationRef.current?.contains(event.target as Node)) setNotificationsOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setNotificationsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [notificationsOpen])

  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={onMenu} aria-label="打开导航">
        <Menu size={20} />
      </button>
      <div>
        <span className="topbar-page">{pageNames[page]}</span>
        <span className="topbar-date">{berlinDate()}</span>
      </div>
      <div className="topbar-actions">
        <button className="search-button"><Search size={17} /><span>搜索</span><kbd>⌘ K</kbd></button>
        <div className="notification-wrap" ref={notificationRef}>
          <button
            className={`icon-button notification-button ${notificationsOpen ? 'active' : ''}`}
            aria-label="通知"
            aria-expanded={notificationsOpen}
            aria-controls="notification-panel"
            onClick={() => setNotificationsOpen((open) => !open)}
          >
            <Bell size={19} />
            {notifications.length > 0 && <span className="notification-dot" />}
          </button>
          {notificationsOpen && (
            <section className="notification-panel" id="notification-panel" aria-label="通知列表">
              <header>
                <div><strong>通知</strong>{notifications.length > 0 && <span>{notifications.length}</span>}</div>
                <button type="button" className="row-action" aria-label="提醒设置" title="提醒设置" onClick={() => { setNotificationsOpen(false); onOpenReminderSettings() }}><Settings size={17} /></button>
              </header>
              {notifications.length === 0 ? (
                <div className="notification-empty"><CheckCircle2 size={22} /><strong>现在没有新提醒</strong><span>今天的安排都在掌握中。</span></div>
              ) : (
                <div className="notification-list">
                  {notifications.map((notification) => (
                    <button type="button" key={notification.key} onClick={() => { setNotificationsOpen(false); onOpenTask(notification.taskId) }}>
                      <span className={`notification-indicator ${notification.tone}`} />
                      <span><strong>{notification.title}</strong><small>{notification.detail}</small></span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </header>
  )
}

function CaptureBar({ value, onChange, onAdd, placeholder = '记下一件事，稍后再安排…' }: {
  value: string
  onChange: (value: string) => void
  onAdd: () => void
  placeholder?: string
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    onAdd()
  }

  return (
    <form className="capture-bar" onSubmit={submit}>
      <Plus size={19} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label="快速记录" />
      <button type="submit" disabled={!value.trim()}>收集</button>
    </form>
  )
}

function TaskCheck({ task, onToggle }: { task: Task; onToggle: (id: number) => void }) {
  return (
    <button
      type="button"
      className={`task-check ${task.completed ? 'checked' : ''}`}
      onClick={() => onToggle(task.id)}
      aria-label={task.completed ? '标记为未完成' : '标记为完成'}
    >
      {task.completed && <Check size={14} strokeWidth={3} />}
    </button>
  )
}

function TodayPage({ tasks, habits, projects, quickEntry, setQuickEntry, addTask, toggleTask, toggleHabit, onOpenTask, onScheduleTask, onNavigate, onAiPlan }: {
  tasks: Task[]
  habits: Habit[]
  projects: Project[]
  quickEntry: string
  setQuickEntry: (value: string) => void
  addTask: () => void
  toggleTask: (id: number) => void
  toggleHabit: (id: number, day: number) => void
  onOpenTask: (id: number) => void
  onScheduleTask: (id: number) => void
  onNavigate: (page: PageKey) => void
  onAiPlan: () => void
}) {
  const scheduled = tasks
    .filter((task) => !task.unscheduled && taskCalendarDate(task) === berlinIsoDate())
    .sort((left, right) => (taskCalendarTime(left) ?? '').localeCompare(taskCalendarTime(right) ?? ''))
  const completed = scheduled.filter((task) => task.completed).length
  const progress = Math.round((completed / Math.max(scheduled.length, 1)) * 100)
  const focusMinutes = scheduled.reduce((sum, task) => sum + task.duration, 0)
  const nextTask = scheduled.find((task) => !task.completed)
  const todayIndex = Array.from({ length: 7 }, (_, index) => currentWeekDateIso(index)).indexOf(berlinIsoDate())
  const rhythmLabel = scheduled.length === 0 ? '暂无安排' : progress >= 75 ? '很顺畅' : progress >= 30 ? '推进中' : '刚开始'
  const rhythmNote = scheduled.length === 0
    ? { title: '今天还是空白页', copy: '先记下一件真正重要的小事就够了。' }
    : nextTask
      ? { title: '按照自己的节奏来', copy: `下一项是“${nextTask.title}”，完成后记得留一点缓冲。` }
      : { title: '今天的安排完成了', copy: '剩下的时间可以安心留给休息。' }

  return (
    <div className="page-content today-page">
      <section className="page-heading today-heading">
        <div>
          <p className="eyebrow">TODAY</p>
          <h1>把今天过清楚</h1>
          <p>{berlinDate()}，已经完成 {completed} 件事。</p>
        </div>
        <div className="today-heading-actions">
          <button type="button" className="outline-button ai-plan-trigger" onClick={onAiPlan}><Sparkles size={17} /> AI 安排</button>
          <div className="today-progress">
            <strong>{progress}%</strong>
            <span>今日进度</span>
            <ProgressBar value={progress} />
          </div>
        </div>
      </section>

      <CaptureBar value={quickEntry} onChange={setQuickEntry} onAdd={addTask} />

      <div className="today-layout">
        <div className="today-main">
          <section className="metric-strip" aria-label="今日概览">
            <div><CheckCircle2 size={19} /><span>任务</span><strong>{completed}/{scheduled.length}</strong></div>
            <div><Clock3 size={19} /><span>计划专注</span><strong>{Math.floor(focusMinutes / 60)}h {focusMinutes % 60}m</strong></div>
            <div><TrendingUp size={19} /><span>今日节奏</span><strong>{rhythmLabel}</strong></div>
          </section>

          <section className="content-section timeline-section">
            <div className="section-title-row">
              <div><h2>今日时间轴</h2><span>{scheduled.length} 项安排</span></div>
              <button className="text-button" onClick={() => onNavigate('calendar')}>调整日程 <ChevronRight size={15} /></button>
            </div>
            <div className="timeline">
              {scheduled.map((task) => (
                <article className={`timeline-item ${task.completed ? 'is-complete' : ''}`} key={task.id}>
                  <div className="timeline-time"><strong>{task.start}</strong><span>{task.end}</span></div>
                  <span className="timeline-dot" style={{ borderColor: task.color, backgroundColor: task.completed ? task.color : '#fff' }} />
                  <div className="timeline-task" style={{ '--task-color': task.color } as React.CSSProperties}>
                    <TaskCheck task={task} onToggle={toggleTask} />
                    <button type="button" className="task-copy task-open-button" onClick={() => onOpenTask(task.id)}>
                      <strong>{task.title}</strong>
                      <span>{task.project} · {task.duration} 分钟</span>
                    </button>
                    <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
                    <button className="row-action" onClick={() => onOpenTask(task.id)} aria-label="查看任务" title="查看任务"><MoreHorizontal size={18} /></button>
                  </div>
                </article>
              ))}
              {scheduled.length === 0 && <p className="empty-copy">今天还没有安排。</p>}
            </div>
          </section>

          <section className="content-section">
            <div className="section-title-row">
              <div><h2>今日习惯</h2><span>{habits.filter((habit) => habit.checked[todayIndex]).length}/{habits.length} 已完成</span></div>
              <button className="text-button" onClick={() => onNavigate('habits')}>全部习惯 <ChevronRight size={15} /></button>
            </div>
            <div className="habit-card-grid">
              {habits.map((habit) => (
                <button
                  key={habit.id}
                  type="button"
                  className={`habit-quick-card ${habit.checked[todayIndex] ? 'checked' : ''}`}
                  onClick={() => toggleHabit(habit.id, todayIndex)}
                  style={{ '--habit-color': habit.color } as React.CSSProperties}
                >
                  <span className="habit-symbol">{habit.name.includes('训练') ? <Dumbbell size={18} /> : habit.name.includes('睡') ? <Moon size={18} /> : habit.name.includes('阅读') ? <BookOpen size={18} /> : <Sun size={18} />}</span>
                  <span><strong>{habit.name}</strong><small>{habit.detail}</small></span>
                  <span className="habit-checkmark">{habit.checked[todayIndex] ? <Check size={15} /> : <Circle size={15} />}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="section-title-row">
              <div><h2>项目推进</h2><span>按最小下一步行动</span></div>
              <button className="text-button" onClick={() => onNavigate('projects')}>查看项目 <ChevronRight size={15} /></button>
            </div>
            <div className="project-snapshot-grid">
              {projects.slice(0, 2).map((project) => (
                <article className="project-snapshot" key={project.id}>
                  <div className="project-snapshot-top">
                    <span className="project-icon" style={{ backgroundColor: `${project.color}18`, color: project.color }}><FolderKanban size={18} /></span>
                    <span>{project.area}</span>
                    <strong>{project.progress}%</strong>
                  </div>
                  <h3>{project.title}</h3>
                  <ProgressBar value={project.progress} color={project.color} />
                  <p>下一步：{project.currentStage}</p>
                </article>
              ))}
              {projects.length === 0 && <p className="empty-copy">还没有项目，先从一个明确目标开始。</p>}
            </div>
          </section>
        </div>

        <aside className="today-aside">
          <section className="aside-section">
            <div className="section-title-row"><h2>接下来</h2>{nextTask && <button className="row-action" onClick={() => onOpenTask(nextTask.id)} aria-label="查看下一项" title="查看下一项"><MoreHorizontal size={18} /></button>}</div>
            {nextTask ? <>
              <button type="button" className="next-task task-open-button" onClick={() => onOpenTask(nextTask.id)}>
                <span className="next-time">{nextTask.start ?? '待定'}</span>
                <div><strong>{nextTask.title}</strong><span>{nextTask.project} · {nextTask.duration} 分钟</span></div>
              </button>
              <button className="outline-button" onClick={() => onOpenTask(nextTask.id)}><AlarmClock size={16} /> 查看提醒设置</button>
            </> : <p className="empty-copy">今天的安排已经完成。</p>}
          </section>
          <section className="aside-section inbox-preview">
            <div className="section-title-row"><h2>待安排</h2><span>{tasks.filter((task) => task.unscheduled).length}</span></div>
            {tasks.filter((task) => task.unscheduled).map((task) => (
              <div className="aside-task" key={task.id}>
                <span style={{ backgroundColor: task.color }} />
                <button type="button" className="aside-task-copy task-open-button" onClick={() => onOpenTask(task.id)}><strong>{task.title}</strong><small>{task.due}</small></button>
                <button className="row-action" onClick={() => onScheduleTask(task.id)} aria-label="安排时间" title="安排时间"><CalendarDays size={16} /></button>
              </div>
            ))}
          </section>
          <section className="aside-section gentle-note">
            <Sparkles size={18} />
            <div><strong>{rhythmNote.title}</strong><p>{rhythmNote.copy}</p></div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function InboxPage({ tasks, quickEntry, setQuickEntry, addTask, toggleTask, onNewTask, onOpenTask, onScheduleTask }: {
  tasks: Task[]
  quickEntry: string
  setQuickEntry: (value: string) => void
  addTask: () => void
  toggleTask: (id: number) => void
  onNewTask?: () => void
  onOpenTask: (id: number) => void
  onScheduleTask: (id: number) => void
}) {
  const [filter, setFilter] = useState<'all' | 'open' | 'done'>('all')
  const visibleTasks = tasks.filter((task) => filter === 'all' || (filter === 'done' ? task.completed : !task.completed))

  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">INBOX</p><h1>收集箱</h1><p>先记下来，再决定什么时候做。</p></div>
        <button className="primary-button" onClick={onNewTask}><Plus size={17} /> 新建任务</button>
      </section>
      <CaptureBar value={quickEntry} onChange={setQuickEntry} onAdd={addTask} placeholder="输入任务、灵感或生活琐事…" />
      <section className="content-section list-section">
        <div className="list-toolbar">
          <div className="segmented-control">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部</button>
            <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>未完成</button>
            <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>已完成</button>
          </div>
          <span className="list-count">{visibleTasks.length} 项</span>
        </div>
        <div className="task-list">
          {visibleTasks.map((task) => (
            <article className={`task-list-row ${task.completed ? 'is-complete' : ''}`} key={task.id}>
              <TaskCheck task={task} onToggle={toggleTask} />
              <span className="task-color" style={{ backgroundColor: task.color }} />
              <button type="button" className="task-list-copy task-open-button" onClick={() => onOpenTask(task.id)}>
                <strong>{task.title}</strong>
                <span>{task.project} · {task.duration} 分钟</span>
              </button>
              <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}优先级</span>
              <span className="task-due"><CalendarDays size={15} />{task.start ? `今天 ${task.start}` : task.due}</span>
              <button className="row-action" onClick={() => task.unscheduled ? onScheduleTask(task.id) : onOpenTask(task.id)} aria-label={task.unscheduled ? '安排时间' : '查看任务'} title={task.unscheduled ? '安排时间' : '查看任务'}>{task.unscheduled ? <CalendarClock size={17} /> : <MoreHorizontal size={18} />}</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function CalendarPage({ tasks, onNewTask, onOpenTask }: { tasks: Task[]; onNewTask: () => void; onOpenTask: (id: number) => void }) {
  const [view, setView] = useState<'day' | 'week' | 'month'>('week')
  const dates = currentWeekDates()
  const hours = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00']
  const todayIndex = Array.from({ length: 7 }, (_, index) => currentWeekDateIso(index)).indexOf(berlinIsoDate())
  const monthCells = currentMonthCells()
  const visibleDates = Array.from(new Set([
    ...Array.from({ length: 7 }, (_, index) => currentWeekDateIso(index)),
    ...monthCells.flatMap((cell) => cell.date ? [cell.date] : []),
  ]))
  const occurrences = calendarOccurrences(tasks, visibleDates)
  const scheduledDates = new Set(occurrences.map((occurrence) => occurrence.date))

  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">CALENDAR</p><h1>日历</h1><p>任务、项目节点和习惯都在同一条时间线上。</p></div>
        <span className="date-button calendar-period">本周</span>
      </section>
      <div className="calendar-toolbar">
        <div className="segmented-control">
          <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>日</button>
          <button className={view === 'week' ? 'active' : ''} onClick={() => setView('week')}>周</button>
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>月</button>
        </div>
        <button className="primary-button" onClick={onNewTask}><Plus size={17} /> 添加日程</button>
      </div>

      {view === 'month' ? (
        <section className="month-grid">
          {weekDays.map((day) => <div className="month-weekday" key={day}>周{day}</div>)}
          {monthCells.map((cell) => (
            <div className={`month-day ${cell.active ? 'active' : ''}`} key={cell.key}>
              {cell.day && <><span>{cell.day}</span>{cell.date && scheduledDates.has(cell.date) && <i />}</>}
            </div>
          ))}
        </section>
      ) : (
        <section className={`week-calendar ${view === 'day' ? 'day-view' : ''}`}>
          <div className="week-head-spacer" />
          {weekDays.map((day, index) => (
            <div className={`week-day-head ${index === todayIndex ? 'today' : ''}`} key={day}><span>周{day}</span><strong>{dates[index]}</strong></div>
          ))}
          {hours.map((hour, hourIndex) => (
            <div className="calendar-row" key={hour}>
              <span className="hour-label">{hour}</span>
              {weekDays.map((day, dayIndex) => (
                <div className={`calendar-cell ${dayIndex === todayIndex ? 'today-column' : ''}`} key={`${hour}-${day}`}>
                  {(() => {
                    const startHour = Number(hour.slice(0, 2))
                    const endHour = hourIndex === hours.length - 1 ? 24 : Number(hours[hourIndex + 1].slice(0, 2))
                    const date = currentWeekDateIso(dayIndex)
                    const cellTasks = occurrences.filter((occurrence) => {
                      const time = occurrence.time
                      const taskHour = time ? Number(time.slice(0, 2)) : -1
                      return occurrence.date === date && taskHour >= startHour && taskHour < endHour
                    })
                    return cellTasks.length > 0 ? <div className="calendar-event-stack">{cellTasks.map((occurrence) => (
                      <button type="button" className={`calendar-event ${occurrence.projected ? 'is-projected' : ''}`} onClick={() => onOpenTask(occurrence.task.id)} style={{ '--event-color': occurrence.task.color } as React.CSSProperties} key={occurrence.key}><strong>{occurrence.task.title}</strong><span>{occurrence.time}–{occurrence.endTime ?? '待定'}</span></button>
                    ))}</div> : null
                  })()}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const reachedIndex = project.progress > 0 ? Math.ceil((project.progress / 100) * project.stages.length) - 1 : -1
  return (
    <article className="project-card">
      <div className="project-card-head">
        <span className="project-icon large" style={{ backgroundColor: `${project.color}18`, color: project.color }}><FolderKanban size={20} /></span>
        <div><span>{project.area}</span><h2>{project.title}</h2></div>
        <button className="row-action"><MoreHorizontal size={19} /></button>
      </div>
      <div className="project-progress-row"><span>整体进度</span><strong>{project.progress}%</strong></div>
      <ProgressBar value={project.progress} color={project.color} />
      <div className="project-stages">
        {project.stages.map((stage, index) => (
          <div className={index <= reachedIndex ? 'reached' : ''} key={stage}>
            <span style={{ borderColor: project.color, backgroundColor: index <= reachedIndex ? project.color : '#fff' }}>{index < reachedIndex ? <Check size={12} /> : index + 1}</span>
            <small>{stage}</small>
          </div>
        ))}
      </div>
      <footer>
        <span><CheckCircle2 size={15} /> {project.completedTasks}/{project.totalTasks} 项任务</span>
        <span><CalendarDays size={15} /> {project.due}</span>
      </footer>
    </article>
  )
}

function ProjectsPage({ projects, onNewProject }: { projects: Project[]; onNewProject: () => void }) {
  const activeProjects = projects.filter((project) => (project.status ?? 'active') === 'active').length
  const completedTasks = projects.reduce((sum, project) => sum + project.completedTasks, 0)
  const averageProgress = projects.length > 0
    ? Math.round(projects.reduce((sum, project) => sum + project.progress, 0) / projects.length)
    : 0
  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">PROJECTS</p><h1>项目</h1><p>一次只推进眼前的下一步。</p></div>
        <button className="primary-button" onClick={onNewProject}><Plus size={17} /> 新建项目</button>
      </section>
      <section className="metric-strip project-metrics">
        <div><FolderKanban size={19} /><span>进行中</span><strong>{activeProjects}</strong></div>
        <div><CheckCircle2 size={19} /><span>已完成任务</span><strong>{completedTasks}</strong></div>
        <div><Target size={19} /><span>平均进度</span><strong>{averageProgress}%</strong></div>
      </section>
      <div className="project-grid">
        {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
        <button className="new-project-card" onClick={onNewProject}><Plus size={22} /><strong>新建项目</strong><span>从目标、阶段和第一步开始</span></button>
      </div>
    </div>
  )
}

function HabitsPage({ habits, toggleHabit, onNewHabit }: { habits: Habit[]; toggleHabit: (id: number, day: number) => void; onNewHabit: () => void }) {
  const dates = currentWeekDates()
  const todayIndex = Array.from({ length: 7 }, (_, index) => currentWeekDateIso(index)).indexOf(berlinIsoDate())
  const completed = habits.reduce((sum, habit) => sum + habit.checked.filter(Boolean).length, 0)
  const weeklyTarget = habits.reduce((sum, habit) => sum + (habit.scheduleDays?.length || 7), 0)
  const habitProgress = weeklyTarget > 0 ? Math.round((completed / weeklyTarget) * 100) : 0
  const longestHabit = habits.reduce<Habit | null>((longest, habit) => !longest || habit.streak > longest.streak ? habit : longest, null)
  const habitStatus = habits.length === 0 ? '暂无记录' : habitProgress >= 80 ? '很稳定' : habitProgress >= 40 ? '推进中' : '刚开始'
  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">HABITS</p><h1>习惯</h1><p>稳定比完美更值得庆祝。</p></div>
        <button className="primary-button" onClick={onNewHabit}><Plus size={17} /> 新建习惯</button>
      </section>
      <section className="habit-summary">
        <div><span>本周完成</span><strong>{completed}<small> / {weeklyTarget}</small></strong><ProgressBar value={habitProgress} /></div>
        <div><span>最长连续</span><strong>{longestHabit?.streak ?? 0}<small> 天</small></strong><p>{longestHabit?.name ?? '尚未创建习惯'}</p></div>
        <div><span>本周状态</span><strong className="steady-text">{habitStatus}</strong><p>{weeklyTarget > 0 ? `已完成本周计划的 ${habitProgress}%` : '创建习惯后开始记录'}</p></div>
      </section>
      <section className="content-section habit-table-section">
        <div className="habit-table-head">
          <span>习惯</span>
          {weekDays.map((day, index) => <span className={index === todayIndex ? 'today' : ''} key={day}>周{day}<strong>{dates[index]}</strong></span>)}
          <span>连续</span>
        </div>
        {habits.map((habit) => (
          <div className="habit-table-row" key={habit.id}>
            <div className="habit-name"><span style={{ backgroundColor: habit.color }} /><div><strong>{habit.name}</strong><small>{habit.detail}</small></div></div>
            {habit.checked.map((checked, index) => (
              <button
                type="button"
                className={`habit-day ${checked ? 'checked' : ''} ${index === todayIndex ? 'today' : ''}`}
                style={{ '--habit-color': habit.color } as React.CSSProperties}
                onClick={() => toggleHabit(habit.id, index)}
                key={index}
                aria-label={`周${weekDays[index]}${checked ? '已完成' : '未完成'}`}
              >
                {checked ? <Check size={15} /> : index > 1 ? <Circle size={13} /> : <span />}
              </button>
            ))}
            <span className="streak-count">{habit.streak} 天</span>
          </div>
        ))}
        {habits.length === 0 && <p className="empty-copy habit-empty">还没有习惯记录。</p>}
      </section>
    </div>
  )
}

function ReviewPage({ summary, tasks }: { summary: ReviewSummary; tasks: Task[] }) {
  const weekDates = Array.from({ length: 7 }, (_, index) => currentWeekDateIso(index))
  const weekTasks = tasks.filter((task) => {
    const date = taskReviewDate(task)
    return date !== null && weekDates.includes(date)
  })
  const completedWeekTasks = weekTasks.filter((task) => task.completed)
  const completedCount = completedWeekTasks.length
  const totalCount = weekTasks.length
  const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const completedMinutes = completedWeekTasks.reduce((sum, task) => sum + task.duration, 0)
  const daily = weekDates.map((date) => {
    const dayTasks = tasks.filter((task) => taskReviewDate(task) === date)
    const completed = dayTasks.filter((task) => task.completed).length
    return {
      total: dayTasks.length,
      completed,
      value: dayTasks.length > 0 ? Math.round((completed / dayTasks.length) * 100) : 0,
    }
  })
  const completedThisWeek = tasks.filter((task) => {
    const date = task.completedAt?.slice(0, 10) ?? taskReviewDate(task)
    return task.completed && date !== null && weekDates.includes(date)
  })
  const categoryMinutes = completedThisWeek.reduce<Record<string, { label: string; color: string; minutes: number }>>((result, task) => {
    const key = task.category || '未分类'
    const current = result[key] ?? { label: key, color: task.color, minutes: 0 }
    current.minutes += task.duration
    result[key] = current
    return result
  }, {})
  const totalCategoryMinutes = completedThisWeek.reduce((sum, task) => sum + task.duration, 0)
  const categoryInvestment = Object.values(categoryMinutes)
    .sort((left, right) => right.minutes - left.minutes)
    .map((category) => ({
      ...category,
      value: totalCategoryMinutes > 0 ? Math.round((category.minutes / totalCategoryMinutes) * 100) : 0,
    }))
  const hasDailyData = daily.some((day) => day.total > 0)
  const strongestCategory = categoryInvestment[0]
  const hours = Math.floor(completedMinutes / 60)
  const minutes = completedMinutes % 60
  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">REVIEW</p><h1>回顾</h1><p>看见真实的节奏，再决定下一步。</p></div>
        <span className="date-button review-period">本周</span>
      </section>
      <section className="review-overview">
        <div className="review-score"><span>本周完成率</span><strong>{completionRate}%</strong><p>每一次完成都会记录</p></div>
        <div><CheckCircle2 size={20} /><span>完成任务</span><strong>{completedCount}</strong><small>共计划 {totalCount} 项</small></div>
        <div><Clock3 size={20} /><span>投入时间</span><strong>{hours}h {minutes}m</strong><small>按已完成任务估算</small></div>
        <div><TimerReset size={20} /><span>逾期任务</span><strong>{summary.overdue}</strong><small>可以随时重新安排</small></div>
      </section>
      <div className="review-grid">
        <section className="content-section chart-section">
          <div className="section-title-row"><div><h2>每日完成情况</h2><span>任务完成率</span></div><TrendingUp size={18} /></div>
          {hasDailyData ? <div className="bar-chart">
            {daily.map((day, index) => <div key={weekDates[index]}><span className={weekDates[index] === berlinIsoDate() ? 'today' : ''} style={{ height: `${day.value}%` }}><i>{day.value}%</i></span><small>周{weekDays[index]}</small></div>)}
          </div> : <div className="review-empty"><BarChart3 size={20} /><strong>本周还没有任务记录</strong><span>完成任务后，这里会生成真实趋势。</span></div>}
        </section>
        <section className="content-section category-section">
          <div className="section-title-row"><div><h2>时间投入</h2><span>按生活领域</span></div></div>
          {categoryInvestment.map((category) => (
            <div className="category-row" key={category.label}>
              <span className="category-dot" style={{ backgroundColor: category.color }} />
              <strong>{category.label}</strong>
              <ProgressBar value={category.value} color={category.color} />
              <span>{Math.floor(category.minutes / 60)}h {category.minutes % 60}m</span>
            </div>
          ))}
          {categoryInvestment.length === 0 && <div className="review-empty compact"><Clock3 size={20} /><strong>暂无时间投入</strong><span>只统计本周已完成任务的预计时长。</span></div>}
        </section>
      </div>
      <section className="content-section reflection-section">
        <div className="section-title-row"><div><h2>本周观察</h2><span>根据现有记录自动整理</span></div></div>
        <div className="reflection-grid">
          <div><strong>本周完成</strong><p>{totalCount > 0 ? `完成 ${completedCount} 项，共记录 ${totalCount} 项，完成率 ${completionRate}%。` : '还没有可供回顾的任务记录。'}</p></div>
          <div><strong>需要留意</strong><p>{summary.overdue > 0 ? `目前有 ${summary.overdue} 项逾期任务，可以重新安排到合适的时间。` : '目前没有逾期任务。'}</p></div>
          <div><strong>主要投入</strong><p>{strongestCategory ? `${strongestCategory.label}投入最多，共 ${Math.floor(strongestCategory.minutes / 60)} 小时 ${strongestCategory.minutes % 60} 分钟。` : '完成带分类的任务后，这里会显示主要投入方向。'}</p></div>
        </div>
      </section>
    </div>
  )
}

function SettingsPage({ settings: initialSettings, activeSection, dataCounts, planImports, onSectionChange, onSave, onTestMail, onChangePassword, onExportData, onImportPlan, onDeletePlanImport, onLogout }: {
  settings: UserSettings
  activeSection: SettingsSectionKey
  dataCounts: { tasks: number; projects: number; habits: number; categories: number }
  planImports: PlanImportBatch[]
  onSectionChange: (section: SettingsSectionKey) => void
  onSave: (settings: UserSettings) => Promise<void>
  onTestMail: () => Promise<void>
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>
  onExportData: () => Promise<void>
  onImportPlan: (plan: PlanImportDocument) => Promise<PlanImportCounts>
  onDeletePlanImport: (id: number) => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [testingMail, setTestingMail] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<PlanImportDocument | null>(null)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [deletingImportId, setDeletingImportId] = useState<number | null>(null)

  useEffect(() => setSettings(initialSettings), [initialSettings])

  async function save() {
    setSaving(true)
    try {
      await onSave(settings)
    } finally {
      setSaving(false)
    }
  }

  async function testMail() {
    setTestingMail(true)
    try {
      await onTestMail()
    } finally {
      setTestingMail(false)
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setPasswordError('')
    if (newPassword.length < 10) {
      setPasswordError('新密码至少需要 10 位。')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致。')
      return
    }

    setChangingPassword(true)
    try {
      await onChangePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordOpen(false)
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : '密码修改失败。')
    } finally {
      setChangingPassword(false)
    }
  }

  async function exportData() {
    setExporting(true)
    try {
      await onExportData()
    } finally {
      setExporting(false)
    }
  }

  function previewImport(text = importText) {
    setImportError('')
    try {
      setImportPreview(parsePlanImportJson(text))
    } catch (error) {
      setImportPreview(null)
      setImportError(error instanceof Error ? error.message : '无法读取这份 JSON。')
    }
  }

  async function loadImportFile(file: File) {
    if (file.size > 1024 * 1024) {
      setImportError('JSON 文件不能超过 1 MB。')
      return
    }
    const text = await file.text()
    setImportText(text)
    previewImport(text)
  }

  async function loadExamplePlan() {
    setImportError('')
    try {
      const examplePath = import.meta.env.DEV
        ? '/public/examples/sakura-daily-routine-v2.json'
        : '/examples/sakura-daily-routine-v2.json'
      const response = await fetch(examplePath, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('无法读取推荐日程。')
      const text = await response.text()
      setImportText(text)
      previewImport(text)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法读取推荐日程。')
    }
  }

  async function importPlan() {
    if (!importPreview) return
    setImporting(true)
    setImportError('')
    try {
      await onImportPlan(importPreview)
      setImportText('')
      setImportPreview(null)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '计划导入失败。')
    } finally {
      setImporting(false)
    }
  }

  async function deletePlanImport(batch: PlanImportBatch) {
    if (!window.confirm(`撤销“${batch.name}”并删除这次导入创建的数据？`)) return
    setDeletingImportId(batch.id)
    setImportError('')
    try {
      await onDeletePlanImport(batch.id)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '撤销导入失败。')
    } finally {
      setDeletingImportId(null)
    }
  }

  return (
    <div className="page-content settings-page">
      <section className="page-heading"><div><p className="eyebrow">SETTINGS</p><h1>设置</h1><p>让看板按照你的生活节奏工作。</p></div></section>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区">
          {settingsSections.map(({ key, label, icon: Icon }) => (
            <button type="button" className={activeSection === key ? 'active' : ''} onClick={() => onSectionChange(key)} aria-current={activeSection === key ? 'page' : undefined} key={key}>
              <Icon size={17} />{label}
            </button>
          ))}
        </nav>
        <div className="settings-main">
          {activeSection === 'account' && (
            <section className="settings-section settings-panel">
              <div className="settings-title"><div><ShieldCheck size={19} /><div><h2>账户与安全</h2><p>单用户账户</p></div></div></div>
              <div className="form-grid">
                <label><span>显示名称</span><input value={settings.displayName} onChange={(event) => setSettings({ ...settings, displayName: event.target.value })} /></label>
                <label><span>登录用户名</span><input value="sakura" disabled /></label>
                <label className="full"><span>邮箱地址</span><div className="field-with-icon"><Mail size={17} /><input value={settings.email} onChange={(event) => setSettings({ ...settings, email: event.target.value })} type="email" /></div></label>
              </div>
              <button type="button" className="outline-button" onClick={() => { setPasswordOpen(!passwordOpen); setPasswordError('') }}><LockKeyhole size={16} /> 修改密码</button>
              {passwordOpen && (
                <form className="password-form" onSubmit={changePassword}>
                  <div className="form-grid">
                    <label className="full"><span>当前密码</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                    <label><span>新密码</span><input type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                    <label><span>确认新密码</span><input type="password" autoComplete="new-password" minLength={10} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
                  </div>
                  {passwordError && <p className="form-error">{passwordError}</p>}
                  <button className="primary-button" disabled={changingPassword}>{changingPassword ? '修改中…' : '确认修改'}</button>
                </form>
              )}
            </section>
          )}

          {activeSection === 'reminders' && (
            <section className="settings-section settings-panel">
              <div className="settings-title"><div><Bell size={19} /><div><h2>邮件提醒</h2><p>提醒将按照柏林时间发送</p></div></div></div>
              <div className="setting-row"><div><strong>任务开始前提醒</strong><span>默认提前 {settings.taskReminderMinutes} 分钟</span></div><Toggle checked={settings.emailReminders} onChange={() => setSettings({ ...settings, emailReminders: !settings.emailReminders })} /></div>
              <div className="setting-row"><div><strong>每日收尾邮件</strong><span>每天 {settings.dailySummaryTime.slice(0, 5)} 汇总进度</span></div><Toggle checked={settings.dailySummary} onChange={() => setSettings({ ...settings, dailySummary: !settings.dailySummary })} /></div>
              <div className="setting-row"><div><strong>逾期任务提醒</strong><span>每天上午发送一次</span></div><Toggle checked={settings.overdueReminder} onChange={() => setSettings({ ...settings, overdueReminder: !settings.overdueReminder })} /></div>
              <button type="button" className="outline-button" onClick={testMail} disabled={testingMail}><Mail size={16} /> {testingMail ? '发送中…' : '发送测试邮件'}</button>
            </section>
          )}

          {activeSection === 'schedule' && (
            <section className="settings-section settings-panel">
              <div className="settings-title"><div><CalendarRange size={19} /><div><h2>日期与时间</h2><p>日程和提醒的默认规则</p></div></div></div>
              <div className="form-grid">
                <label><span>时区</span><select value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}><option value="Europe/Berlin">Europe/Berlin</option><option value="Asia/Shanghai">Asia/Shanghai</option></select></label>
                <label><span>一周开始于</span><select value={settings.weekStartsOn} onChange={(event) => setSettings({ ...settings, weekStartsOn: event.target.value as 'monday' | 'sunday' })}><option value="monday">星期一</option><option value="sunday">星期日</option></select></label>
                <label><span>任务默认提前提醒</span><input type="number" min="0" max="10080" value={settings.taskReminderMinutes} onChange={(event) => setSettings({ ...settings, taskReminderMinutes: Number(event.target.value) })} /></label>
                <label><span>每日收尾时间</span><input type="time" value={settings.dailySummaryTime.slice(0, 5)} onChange={(event) => setSettings({ ...settings, dailySummaryTime: `${event.target.value}:00` })} /></label>
              </div>
            </section>
          )}

          {activeSection === 'data' && (
            <section className="settings-section settings-panel">
              <div className="settings-title"><div><Archive size={19} /><div><h2>数据备份</h2><p>导出当前账户的完整看板数据</p></div></div></div>
              <div className="data-summary">
                <div><strong>{dataCounts.tasks}</strong><span>任务</span></div>
                <div><strong>{dataCounts.projects}</strong><span>项目</span></div>
                <div><strong>{dataCounts.habits}</strong><span>习惯</span></div>
                <div><strong>{dataCounts.categories}</strong><span>分类</span></div>
              </div>
              <button type="button" className="outline-button" onClick={exportData} disabled={exporting}><Download size={16} /> {exporting ? '导出中…' : '导出 JSON 备份'}</button>
              <div className="settings-divider" />
              <div className="settings-title"><div><Upload size={19} /><div><h2>计划导入</h2><p>追加项目、习惯和重复任务</p></div></div></div>
              <textarea
                className="plan-import-textarea"
                aria-label="计划 JSON"
                value={importText}
                onChange={(event) => { setImportText(event.target.value); setImportPreview(null); setImportError('') }}
                placeholder={'{\n  "schemaVersion": 1,\n  "importKey": "my-plan-v1"\n}'}
                spellCheck={false}
              />
              <div className="plan-import-actions">
                <label className="outline-button plan-file-button"><Upload size={16} /> 选择 JSON 文件<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadImportFile(file); event.currentTarget.value = '' }} /></label>
                <button type="button" className="outline-button" onClick={() => void loadExamplePlan()}><BookOpen size={16} /> 载入推荐日程</button>
                <button type="button" className="outline-button" onClick={() => previewImport()} disabled={!importText.trim()}>检查内容</button>
              </div>
              {importError && <p className="form-error">{importError}</p>}
              {importPreview && (
                <div className="plan-import-preview">
                  <div><strong>{importPreview.name ?? '生活计划'}</strong><span>从 {planStartDateLabel(importPreview.startDate)}开始 · {importPreview.timezone ?? settings.timezone}</span></div>
                  <div className="plan-import-counts">
                    <span><strong>{importPreview.projects?.length ?? 0}</strong> 项目</span>
                    <span><strong>{importPreview.habits?.length ?? 0}</strong> 习惯</span>
                    <span><strong>{importPreview.tasks?.length ?? 0}</strong> 任务</span>
                  </div>
                  <button type="button" className="primary-button" onClick={() => void importPlan()} disabled={importing}>{importing ? '导入中…' : '确认导入'}</button>
                </div>
              )}
              {planImports.length > 0 && (
                <div className="plan-import-history">
                  {planImports.map((batch) => (
                    <div className="plan-import-history-row" key={batch.id}>
                      <div><strong>{batch.name}</strong><span>{taskMoment(batch.createdAt)} · {batch.counts.projects ?? 0} 项目 · {batch.counts.habits ?? 0} 习惯 · {batch.counts.tasks ?? 0} 任务</span></div>
                      <button type="button" className="danger-button" onClick={() => void deletePlanImport(batch)} disabled={deletingImportId !== null}><Trash2 size={15} />{deletingImportId === batch.id ? '撤销中…' : '撤销导入'}</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {activeSection !== 'data' && (
            <div className="settings-actions">
              <button type="button" className="primary-button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存设置'}</button>
              {activeSection === 'account' && <button type="button" className="danger-button" onClick={onLogout}><LogOut size={16} /> 退出登录</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MobileNav({ page, setPage }: { page: PageKey; setPage: (page: PageKey) => void }) {
  return (
    <nav className="mobile-nav" aria-label="移动端导航">
      {navigation.slice(0, 5).map(({ key, label, icon: Icon }) => (
        <button className={page === key ? 'active' : ''} onClick={() => setPage(key)} key={key}>
          <Icon size={19} /><span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [demoMode, setDemoMode] = useState(false)
  const [page, setPage] = useState<PageKey>(() => routeFromLocation().page)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionKey>(() => routeFromLocation().settingsSection)
  const [tasks, setTasks] = useState(initialTasks)
  const [habits, setHabits] = useState(initialHabits)
  const [projectItems, setProjectItems] = useState(initialProjects)
  const [categories, setCategories] = useState<Category[]>([
    { id: 1, name: '工作', color: '#496d5b' },
    { id: 2, name: '学习', color: '#b96552' },
    { id: 3, name: '健康', color: '#58748f' },
    { id: 4, name: '成长', color: '#a1843e' },
    { id: 5, name: '生活', color: '#7a6b87' },
  ])
  const [planImports, setPlanImports] = useState<PlanImportBatch[]>([])
  const [settings, setSettings] = useState(defaultSettings)
  const [review, setReview] = useState(defaultReview)
  const [editor, setEditor] = useState<EditorState>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [quickEntry, setQuickEntry] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [aiPlannerOpen, setAiPlannerOpen] = useState(false)
  const [aiPlan, setAiPlan] = useState<AiPlan | null>(null)
  const [aiPlanLoading, setAiPlanLoading] = useState(false)
  const [aiPlanApplying, setAiPlanApplying] = useState(false)
  const [aiPlanError, setAiPlanError] = useState('')

  const inboxCount = useMemo(() => tasks.filter((task) => !task.completed && task.unscheduled).length, [tasks])
  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId), [selectedTaskId, tasks])
  const editorTask = editor?.type === 'task' && editor.taskId
    ? tasks.find((task) => task.id === editor.taskId)
    : undefined

  useEffect(() => {
    const syncRoute = () => {
      const route = routeFromLocation()
      setPage(route.page)
      setSettingsSection(route.settingsSection)
      setMenuOpen(false)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [])

  useEffect(() => {
    let active = true
    api.session()
      .then(async (session) => {
        if (!active) return
        if (!session.authenticated) {
          setLoggedIn(false)
          return
        }
        const data = await api.bootstrap()
        if (active) {
          applyBootstrap(data)
          setLoggedIn(true)
        }
      })
      .catch(() => {
        if (!active) return
        if (import.meta.env.DEV) {
          setDemoMode(true)
          setLoggedIn(true)
        } else {
          setLoggedIn(false)
        }
      })

    return () => { active = false }
  }, [])

  function applyBootstrap(data: BootstrapData) {
    setTasks(data.tasks)
    setHabits(data.habits)
    setProjectItems(data.projects)
    setCategories(data.categories)
    setPlanImports(data.planImports ?? [])
    setSettings(data.settings)
    setReview(data.review)
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  function demoAiPlan(): AiPlan {
    const source = tasks.filter((task) => !task.completed && task.unscheduled).slice(0, 8)
    if (source.length === 0) throw new Error('收集箱里没有需要安排的任务。')
    const today = berlinIsoDate()
    const nowParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const nowMinutes = Number(nowParts.find((part) => part.type === 'hour')?.value ?? 8) * 60
      + Number(nowParts.find((part) => part.type === 'minute')?.value ?? 0)
    const occupied = tasks.flatMap((task) => {
      const date = task.startAt?.slice(0, 10) ?? (task.start && !task.unscheduled ? today : null)
      const start = task.startAt?.slice(11, 16) ?? task.start
      const end = task.endAt?.slice(11, 16) ?? task.end
      if (task.completed || !date || !start || !end) return []
      return [{
        date,
        start: Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)),
        end: Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)),
      }]
    })
    const items: AiPlan['items'] = []
    const skipped: AiPlan['skipped'] = []

    source.forEach((task) => {
      const duration = Math.max(1, task.duration)
      let slot: { date: string; start: number } | null = null
      for (let dayOffset = 0; dayOffset < 7 && !slot; dayOffset += 1) {
        const date = shiftIsoDate(today, dayOffset)
        let cursor = dayOffset === 0
          ? Math.max(8 * 60, Math.ceil((nowMinutes + 15) / 15) * 15)
          : 8 * 60
        while (cursor + duration <= 21 * 60) {
          const conflict = occupied
            .filter((block) => block.date === date && cursor < block.end && cursor + duration > block.start)
            .sort((left, right) => left.end - right.end)[0]
          if (!conflict) {
            slot = { date, start: cursor }
            break
          }
          cursor = Math.ceil((conflict.end + 15) / 15) * 15
        }
      }

      if (!slot) {
        skipped.push({ taskId: task.id, title: task.title, reason: '未来七天没有足够长的空闲时段。' })
        return
      }
      occupied.push({ date: slot.date, start: slot.start, end: slot.start + duration + 15 })
      items.push({
        taskId: task.id,
        title: task.title,
        startAt: localDateTime(slot.date, slot.start),
        endAt: localDateTime(slot.date, slot.start + duration),
        duration,
        priority: task.priority,
        reason: task.dueAt ? '优先靠近截止时间，并保留任务间的缓冲。' : '按照优先级放入可用时段。',
      })
    })
    if (items.length === 0) throw new Error('未来七天没有足够的空闲时间，请先调整现有日程。')
    return {
      id: -1,
      model: 'demo',
      summary: `已为 ${items.length} 项任务留出完整时间，并在任务之间保留缓冲。`,
      items,
      skipped,
      remainingUses: 1,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }
  }

  async function generateAiPlan() {
    setAiPlanLoading(true)
    setAiPlan(null)
    setAiPlanError('')
    try {
      setAiPlan(demoMode ? demoAiPlan() : await api.createAiPlan())
    } catch (error) {
      setAiPlanError(error instanceof Error ? error.message : 'AI 暂时无法生成安排，请稍后再试。')
    } finally {
      setAiPlanLoading(false)
    }
  }

  function openAiPlanner() {
    setAiPlannerOpen(true)
    void generateAiPlan()
  }

  async function applyAiPlan() {
    if (!aiPlan) return
    setAiPlanApplying(true)
    setAiPlanError('')
    try {
      if (demoMode) {
        const itemMap = new Map(aiPlan.items.map((item) => [item.taskId, item]))
        setTasks((current) => current.map((task) => {
          const item = itemMap.get(task.id)
          return item ? {
            ...task,
            startAt: item.startAt,
            endAt: item.endAt,
            start: item.startAt.slice(11, 16),
            end: item.endAt.slice(11, 16),
            duration: item.duration,
            priority: item.priority,
            unscheduled: false,
            status: 'planned',
          } : task
        }))
      } else {
        applyBootstrap(await api.applyAiPlan(aiPlan.id))
      }
      setAiPlannerOpen(false)
      setAiPlan(null)
      showToast(`已采用 ${aiPlan.items.length} 项 AI 安排`)
    } catch (error) {
      setAiPlanError(error instanceof Error ? error.message : 'AI 安排保存失败，请稍后再试。')
    } finally {
      setAiPlanApplying(false)
    }
  }

  async function addTask() {
    const title = quickEntry.trim()
    if (!title) return
    const temporaryId = Date.now()
    const temporaryTask: Task = {
      id: temporaryId,
      title,
      project: '未分类',
      category: '收集箱',
      color: '#7a6b87',
      priority: 'medium',
      duration: 30,
      completed: false,
      unscheduled: true,
      due: '待安排',
    }
    setTasks((current) => [temporaryTask, ...current])
    setQuickEntry('')
    showToast('已放入收集箱')

    if (!demoMode) {
      try {
        const created = await api.createTask({ title, duration: 30, priority: 'medium' })
        setTasks((current) => current.map((task) => task.id === temporaryId ? created : task))
      } catch (error) {
        setTasks((current) => current.filter((task) => task.id !== temporaryId))
        showToast(error instanceof Error ? error.message : '任务保存失败')
      }
    }
  }

  async function toggleTask(id: number) {
    const task = tasks.find((item) => item.id === id)
    if (!task) return
    const completed = !task.completed
    setTasks((current) => current.map((item) => item.id === id ? { ...item, completed: !item.completed } : item))
    if (completed) showToast('完成一件，今天向前了一点')
    if (!demoMode) {
      try {
        const result = await api.updateTask({ id, completed })
        setTasks((current) => {
          const updated = current.map((item) => item.id === id ? result.task : item)
          return result.nextTask && !updated.some((item) => item.id === result.nextTask?.id)
            ? [...updated, result.nextTask]
            : updated
        })
        if (result.nextTask) showToast('已完成，下一次重复任务也安排好了')
      } catch (error) {
        setTasks((current) => current.map((item) => item.id === id ? task : item))
        showToast(error instanceof Error ? error.message : '任务状态保存失败')
      }
    }
  }

  async function toggleSubtask(taskId: number, subtask: Subtask) {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) return
    const completed = !subtask.completed
    setTasks((current) => current.map((item) => item.id === taskId ? {
      ...item,
      subtasks: (item.subtasks ?? []).map((entry) => entry.id === subtask.id ? { ...entry, completed } : entry),
    } : item))
    if (!demoMode) {
      try {
        const updated = await api.updateSubtask(taskId, subtask.id, completed)
        setTasks((current) => current.map((item) => item.id === taskId ? updated : item))
      } catch (error) {
        setTasks((current) => current.map((item) => item.id === taskId ? task : item))
        showToast(error instanceof Error ? error.message : '子任务状态保存失败')
      }
    }
  }

  async function toggleHabit(id: number, day: number) {
    const currentHabit = habits.find((habit) => habit.id === id)
    if (!currentHabit) return
    const checked = !currentHabit.checked[day]
    setHabits((current) => current.map((habit) => {
      if (habit.id !== id) return habit
      const nextChecked = [...habit.checked]
      nextChecked[day] = checked
      return { ...habit, checked: nextChecked }
    }))
    showToast('习惯记录已更新')
    if (!demoMode) {
      try {
        await api.checkHabit(id, currentWeekDateIso(day), checked)
      } catch (error) {
        setHabits((current) => current.map((habit) => habit.id === id ? currentHabit : habit))
        showToast(error instanceof Error ? error.message : '习惯记录保存失败')
      }
    }
  }

  async function login(username: string, password: string) {
    if (demoMode) {
      setLoggedIn(true)
      return
    }
    await api.login(username, password)
    const data = await api.bootstrap()
    applyBootstrap(data)
    setLoggedIn(true)
  }

  async function logout() {
    if (!demoMode) await api.logout()
    setLoggedIn(false)
  }

  async function saveSettings(nextSettings: UserSettings) {
    if (!demoMode) await api.updateSettings(nextSettings)
    setSettings(nextSettings)
    showToast('设置已保存')
  }

  async function testMail() {
    if (demoMode) {
      showToast('演示模式不会发送真实邮件')
      return
    }
    try {
      await api.testMail()
      showToast('测试邮件已发送')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '测试邮件发送失败')
    }
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    if (demoMode) {
      showToast('演示模式不会修改真实密码')
      return
    }
    await api.changePassword(currentPassword, newPassword)
    showToast('登录密码已更新')
  }

  async function exportData() {
    try {
      const data = demoMode
        ? { exportedAt: new Date().toISOString(), tasks, projects: projectItems, habits, categories, settings }
        : await api.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `life-dashboard-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      showToast('数据备份已导出')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '数据导出失败')
    }
  }

  async function importPlan(plan: PlanImportDocument) {
    if (demoMode) throw new Error('演示模式不会写入真实数据，请在服务器版本中导入。')
    const result = await api.importPlan(plan)
    applyBootstrap(result)
    const counts = result.imported
    showToast(`已导入 ${counts.projects} 个项目、${counts.habits} 个习惯和 ${counts.tasks} 个任务`)
    return counts
  }

  async function deletePlanImport(id: number) {
    if (demoMode) throw new Error('演示模式没有可撤销的真实导入。')
    const result = await api.deletePlanImport(id)
    applyBootstrap(result)
    showToast('这次导入的数据已删除')
  }

  async function saveTask(draft: TaskDraft) {
    if (!demoMode) {
      if (draft.id) {
        const result = await api.updateTask(draft as Partial<Task> & { id: number })
        setTasks((current) => current.map((task) => task.id === draft.id ? result.task : task))
        showToast('任务已更新')
        return
      }
      const created = await api.createTask(draft)
      setTasks((current) => [created, ...current])
      showToast('任务已创建')
      return
    }

    const category = categories.find((item) => item.id === draft.categoryId)
    const project = projectItems.find((item) => item.id === draft.projectId)
    const existing = draft.id ? tasks.find((task) => task.id === draft.id) : undefined
    const saved: Task = {
      ...existing,
      id: existing?.id ?? Date.now(),
      title: draft.title,
      notes: draft.notes,
      project: project?.title ?? '未分类',
      projectId: project?.id ?? null,
      category: category?.name ?? '收集箱',
      categoryId: category?.id ?? null,
      color: category?.color ?? '#7a6b87',
      priority: draft.priority ?? 'medium',
      start: draft.startAt?.slice(11, 16),
      end: draft.endAt?.slice(11, 16),
      startAt: draft.startAt,
      endAt: draft.endAt,
      dueAt: draft.dueAt,
      due: draft.dueAt ? draft.dueAt.replace('T', ' ').slice(0, 16) : '待安排',
      duration: draft.duration ?? 30,
      completed: existing?.completed ?? false,
      unscheduled: !draft.startAt,
      recurrenceRule: draft.recurrenceRule,
      reminderMinutes: draft.reminderMinutes,
      subtasks: (draft.subtasks ?? []).map((subtask, index) => ({
        id: subtask.id ?? Date.now() + index,
        title: subtask.title,
        completed: Boolean(subtask.completed),
        position: index,
      })),
    }
    setTasks((current) => existing
      ? current.map((task) => task.id === existing.id ? saved : task)
      : [saved, ...current])
    showToast(existing ? '任务已更新' : '任务已创建')
  }

  async function deleteTask(id: number) {
    const task = tasks.find((item) => item.id === id)
    if (!task) return
    if (!demoMode) {
      try {
        await api.deleteTask(id)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '任务删除失败')
        throw error
      }
    }
    setTasks((current) => current.filter((item) => item.id !== id))
    setSelectedTaskId(null)
    showToast('任务已删除')
  }

  function openTask(id: number) {
    setSelectedTaskId(id)
  }

  function editTask(id: number, schedule = false) {
    setSelectedTaskId(null)
    setEditor({ type: 'task', taskId: id, schedule })
  }

  async function saveProject(draft: Partial<Project> & { title: string }) {
    if (!demoMode) {
      applyBootstrap(await api.createProject(draft))
      showToast('项目已创建')
      return
    }
    setProjectItems((current) => [{
      id: Date.now(),
      title: draft.title,
      description: draft.description,
      area: draft.area ?? '个人',
      color: draft.color ?? '#496d5b',
      progress: 0,
      due: draft.dueAt?.slice(0, 10) ?? '未设置',
      dueAt: draft.dueAt,
      currentStage: draft.currentStage ?? draft.stages?.[0] ?? '确定下一步',
      completedTasks: 0,
      totalTasks: 0,
      stages: draft.stages ?? [],
      status: 'active',
    }, ...current])
    showToast('项目已创建')
  }

  async function saveHabit(draft: Partial<Habit> & { name: string }) {
    if (!demoMode) {
      applyBootstrap(await api.createHabit(draft))
      showToast('习惯已创建')
      return
    }
    setHabits((current) => [...current, {
      id: Date.now(),
      name: draft.name,
      description: draft.description,
      detail: draft.frequencyType === 'weekly' ? `每周 ${draft.targetCount ?? 1} 次` : '每天',
      color: draft.color ?? '#496d5b',
      streak: 0,
      checked: [false, false, false, false, false, false, false],
      frequencyType: draft.frequencyType,
      targetCount: draft.targetCount,
      scheduleDays: draft.scheduleDays,
      allowMakeup: true,
    }])
    showToast('习惯已创建')
  }

  function navigate(next: PageKey) {
    const path = pathForPage(next, settingsSection)
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setPage(next)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function navigateSettings(next: SettingsSectionKey) {
    const path = pathForPage('settings', next)
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setPage('settings')
    setSettingsSection(next)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loggedIn === null) {
    return <main className="loading-shell"><div className="brand-mark large"><span>行</span></div><span>正在打开人生看板…</span></main>
  }

  if (!loggedIn) return <LoginScreen onLogin={login} />

  return (
    <div className="app-shell">
      <Sidebar page={page} setPage={navigate} inboxCount={inboxCount} displayName={settings.displayName} />
      {menuOpen && <button className="nav-scrim" onClick={() => setMenuOpen(false)} aria-label="关闭导航" />}
      <div className={`mobile-sidebar-wrap ${menuOpen ? 'open' : ''}`}>
        <button className="mobile-sidebar-close" onClick={() => setMenuOpen(false)} aria-label="关闭导航"><X size={20} /></button>
        <Sidebar page={page} setPage={navigate} inboxCount={inboxCount} displayName={settings.displayName} />
      </div>
      <div className="app-main">
        <Topbar page={page} tasks={tasks} onMenu={() => setMenuOpen(true)} onOpenTask={openTask} onOpenReminderSettings={() => navigateSettings('reminders')} />
        {page === 'today' && <TodayPage tasks={tasks} habits={habits} projects={projectItems} quickEntry={quickEntry} setQuickEntry={setQuickEntry} addTask={addTask} toggleTask={toggleTask} toggleHabit={toggleHabit} onOpenTask={openTask} onScheduleTask={(id) => editTask(id, true)} onNavigate={navigate} onAiPlan={openAiPlanner} />}
        {page === 'inbox' && <InboxPage tasks={tasks} quickEntry={quickEntry} setQuickEntry={setQuickEntry} addTask={addTask} toggleTask={toggleTask} onNewTask={() => setEditor({ type: 'task' })} onOpenTask={openTask} onScheduleTask={(id) => editTask(id, true)} />}
        {page === 'calendar' && <CalendarPage tasks={tasks} onNewTask={() => setEditor({ type: 'task', schedule: true })} onOpenTask={openTask} />}
        {page === 'projects' && <ProjectsPage projects={projectItems} onNewProject={() => setEditor({ type: 'project' })} />}
        {page === 'habits' && <HabitsPage habits={habits} toggleHabit={toggleHabit} onNewHabit={() => setEditor({ type: 'habit' })} />}
        {page === 'review' && <ReviewPage summary={review} tasks={tasks} />}
        {page === 'settings' && <SettingsPage settings={settings} activeSection={settingsSection} dataCounts={{ tasks: tasks.length, projects: projectItems.length, habits: habits.length, categories: categories.length }} planImports={planImports} onSectionChange={navigateSettings} onSave={saveSettings} onTestMail={testMail} onChangePassword={changePassword} onExportData={exportData} onImportPlan={importPlan} onDeletePlanImport={deletePlanImport} onLogout={logout} />}
      </div>
      <MobileNav page={page} setPage={navigate} />
      {selectedTask && <TaskDetail task={selectedTask} onClose={() => setSelectedTaskId(null)} onEdit={() => editTask(selectedTask.id)} onSchedule={() => editTask(selectedTask.id, true)} onDelete={() => deleteTask(selectedTask.id)} onToggle={() => toggleTask(selectedTask.id)} onToggleSubtask={(subtask) => toggleSubtask(selectedTask.id, subtask)} />}
      {editor?.type === 'task' && <TaskEditor task={editorTask} schedule={editor.schedule} projects={projectItems} categories={categories} defaultReminderMinutes={settings.taskReminderMinutes} onClose={() => setEditor(null)} onSave={saveTask} />}
      {editor?.type === 'project' && <ProjectEditor onClose={() => setEditor(null)} onSave={saveProject} />}
      {editor?.type === 'habit' && <HabitEditor onClose={() => setEditor(null)} onSave={saveHabit} />}
      {aiPlannerOpen && <AiPlannerModal plan={aiPlan} loading={aiPlanLoading} applying={aiPlanApplying} error={aiPlanError} onClose={() => setAiPlannerOpen(false)} onRetry={() => void generateAiPlan()} onApply={() => void applyAiPlan()} />}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  )
}
