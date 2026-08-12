import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlarmClock,
  Archive,
  BarChart3,
  BatteryMedium,
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
  Coffee,
  Copy,
  CornerDownRight,
  Dumbbell,
  Download,
  Eye,
  EyeOff,
  FolderKanban,
  Flag,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  Plus,
  Pencil,
  Pause,
  Play,
  Repeat2,
  RefreshCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Smartphone,
  Sun,
  Sunrise,
  Sunset,
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
import { buildPlanImportPrompt } from './planImportPrompt'
import type { AiPlan, AiPlanScope, BackupPreview, BackupRecord, BootstrapData, Category, DailyRhythm, EveningDecision, FailureReason, Habit, MorningCheckinInput, PageKey, PlanImportBatch, PlanImportCounts, PlanImportDocument, Project, RebalanceInput, RescueInput, RescueOutcome, RescueReason, ReviewSummary, Subtask, Task, UserSettings } from './types'

const navigation = [
  { key: 'now' as const, label: '现在', icon: Play },
  { key: 'today' as const, label: '今日', icon: LayoutDashboard },
  { key: 'inbox' as const, label: '收集箱', icon: Inbox },
  { key: 'calendar' as const, label: '日历', icon: CalendarDays },
  { key: 'projects' as const, label: '项目', icon: FolderKanban },
  { key: 'habits' as const, label: '习惯', icon: Target },
  { key: 'review' as const, label: '回顾', icon: BarChart3 },
]

const pageNames: Record<PageKey, string> = {
  now: '现在',
  today: '今日',
  inbox: '收集箱',
  calendar: '日历',
  projects: '项目',
  habits: '习惯',
  review: '回顾',
  settings: '设置',
}

const priorityLabels = { high: '高', medium: '中', low: '低' }
const failureReasonLabels: Record<FailureReason, string> = {
  time: '时间不够',
  energy: '精力不足',
  interrupted: '临时有事',
  difficult: '任务太难',
  resistance: '不想开始',
  changed: '计划改变',
}
const failureReasonOptions = Object.entries(failureReasonLabels) as Array<[FailureReason, string]>

const rescueReasonLabels: Record<RescueReason, string> = {
  low_energy: '没什么精力',
  too_big: '任务看起来太大',
  unclear: '不知道从哪开始',
  not_convenient: '现在不太方便',
}

function suggestedRescueStep(task: Task, reason: RescueReason) {
  const firstSubtask = task.subtasks?.find((subtask) => !subtask.completed)?.title.trim()
  if (firstSubtask) return `只做第一小步：${firstSubtask}`
  if (/sharplingo|学习|课程|阅读|笔记|复习|德语|英语/i.test(task.title)) return '打开学习页面，只完成一个最小练习'
  if (/健身|训练|运动|拉伸|跑步/i.test(task.title)) return '换好衣服，完成第一组热身动作'
  if (/洗漱|护肤|刷牙|洗澡/i.test(task.title)) return '先走到洗手台，完成第一步'
  if (/火影|三角洲|永劫|游戏|日常/i.test(task.title)) return '打开游戏，只完成第一项日常'
  if (reason === 'low_energy') return `先打开“${task.title}”需要的页面或工具`
  if (reason === 'too_big') return `只完成“${task.title}”的第一个小步骤`
  if (reason === 'unclear') return `写下“${task.title}”接下来唯一的一步`
  return `准备好“${task.title}”需要的东西`
}

const defaultSettings: UserSettings = {
  displayName: 'Sakura',
  email: '',
  timezone: 'Europe/Berlin',
  emailReminders: true,
  pushTaskReminders: true,
  dailySummary: true,
  pushDailySummary: true,
  dailySummaryTime: '21:30:00',
  overdueReminder: false,
  pushOverdueReminder: false,
  taskReminderMinutes: 10,
  weekStartsOn: 'monday',
  planningStartTime: '09:00',
  planningEndTime: '23:30',
  lunchStartTime: '12:30',
  lunchEndTime: '13:30',
  dinnerStartTime: '18:00',
  dinnerEndTime: '19:00',
  planningBufferMinutes: 15,
}

const defaultReview: ReviewSummary = {
  weekStart: '',
  weekEnd: '',
  total: 0,
  completed: 0,
  completionRate: 0,
  plannedMinutes: 0,
  completedMinutes: 0,
  focusPlannedMinutes: 0,
  focusActualMinutes: 0,
  rescueStarts: 0,
  rescueContinued: 0,
  rescueMinutes: 0,
  rescueReasons: [],
  overdue: 0,
  dailyFocusSelected: 0,
  dailyFocusCompleted: 0,
  dailyFocusRate: 0,
  morningCheckins: 0,
  eveningCheckins: 0,
  breakfastDays: 0,
  averageMorningEnergy: null,
  averageEveningEnergy: null,
  averageWakeTime: null,
  calibrationSamples: 0,
  calibrationEstimatedMinutes: 0,
  calibrationActualMinutes: 0,
  estimateAccuracy: null,
  failureReasons: [],
  carryovers: { tomorrow: 0, later: 0, drop: 0 },
  days: [],
}

function emptyDailyRhythm(): DailyRhythm {
  return {
    date: berlinIsoDate(),
    morningStatus: 'pending',
    wakeTime: null,
    hadBreakfast: null,
    morningEnergy: null,
    focusTaskId: null,
    focusTaskTitle: null,
    morningCompletedAt: null,
    eveningEnergy: null,
    reflection: '',
    closedAt: null,
    morningStreak: 0,
    eveningStreak: 0,
  }
}

const palette = ['#496d5b', '#b96552', '#58748f', '#a1843e', '#7a6b87']

type TaskSubtaskDraft = Partial<Subtask> & { title: string }

type TaskDraft = Omit<Partial<Task>, 'subtasks'> & {
  title: string
  subtasks?: TaskSubtaskDraft[]
  updateScope?: 'single' | 'future'
}

type FocusAction = 'start' | 'pause' | 'resume' | 'end'
type IdlePermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported'

type FocusIdleWarning = {
  taskId: number
  taskTitle: string
  detectedAt: number
  deadlineAt: number
}

interface IdleDetectorInstance extends EventTarget {
  userState: 'active' | 'idle' | null
  screenState: 'locked' | 'unlocked' | null
  start: (options: { threshold: number; signal: AbortSignal }) => Promise<void>
}

interface IdleDetectorConstructor {
  new (): IdleDetectorInstance
  requestPermission: () => Promise<'granted' | 'denied'>
}

type BrowserPushState = {
  supported: boolean
  ios: boolean
  standalone: boolean
  configured: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
  subscriptionCount: number
}

function isIosDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function pushApplicationKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)))
}

const initialBrowserPush: BrowserPushState = {
  supported: pushSupported(),
  ios: isIosDevice(),
  standalone: isStandaloneApp(),
  configured: false,
  permission: pushSupported() ? Notification.permission : 'unsupported',
  subscribed: false,
  subscriptionCount: 0,
}

declare global {
  interface Window {
    IdleDetector?: IdleDetectorConstructor
  }
}

const focusIdleThresholdSeconds = 10 * 60
const focusIdleConfirmationSeconds = 60

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
  const validPages: PageKey[] = ['now', 'today', 'inbox', 'calendar', 'projects', 'habits', 'review', 'settings']
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
  const occurrences: CalendarOccurrence[] = scheduledTasks.flatMap((task) => task.scheduleBlocks?.length
    ? task.scheduleBlocks.map((block) => ({
        key: `task-${task.id}-block-${block.id}`,
        task,
        date: block.startAt.slice(0, 10),
        time: block.start,
        endTime: block.end,
        projected: false,
      }))
    : [{
        key: `task-${task.id}`,
        task,
        date: taskCalendarDate(task) as string,
        time: taskCalendarTime(task),
        endTime: task.endAt?.slice(11, 16) ?? task.end ?? null,
        projected: false,
      }])
  const parentIds = new Set(tasks.map((task) => task.recurrenceSourceTaskId).filter((id): id is number => typeof id === 'number'))
  const leaves = scheduledTasks.filter((task) => task.recurrenceRule && !parentIds.has(task.id))
  for (const task of leaves) {
    for (const date of dates) {
      if (!taskRepeatsOnDate(task, date)) continue
      if (task.recurrencePausedUntil && date < task.recurrencePausedUntil) continue
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

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Older iOS web apps can expose Clipboard API while rejecting writes.
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('当前浏览器无法复制，请手动选择提示词。')
}

function taskScheduleLabel(task: Task) {
  if (task.startAt) return taskMoment(task.startAt)
  if (task.start) return `今天 ${task.start}`
  return '待安排'
}

function timeToMinutes(value?: string | null) {
  if (!value) return null
  const match = value.match(/^(\d{2}):(\d{2})/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function berlinClockMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

function berlinClockTime(date = new Date()) {
  const minutes = berlinClockMinutes(date)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function taskStartMinutes(task: Task) {
  return timeToMinutes(taskCalendarTime(task))
}

function taskEndMinutes(task: Task) {
  return timeToMinutes(task.endAt?.slice(11, 16) ?? task.end)
    ?? ((taskStartMinutes(task) ?? 0) + task.duration)
}

function isOpenTask(task: Task) {
  return !task.completed && !task.skipped && task.status !== 'cancelled'
}

function morningFocusTaskOptions(tasks: Task[]) {
  const today = berlinIsoDate()
  const seen = new Set<string>()

  return tasks
    .filter((task) => isOpenTask(task) && (task.unscheduled || taskCalendarDate(task) === today))
    .sort((left, right) => {
      const leftToday = taskCalendarDate(left) === today ? 0 : 1
      const rightToday = taskCalendarDate(right) === today ? 0 : 1
      return leftToday - rightToday
        || taskPriorityWeight(left) - taskPriorityWeight(right)
        || (taskStartMinutes(left) ?? 24 * 60) - (taskStartMinutes(right) ?? 24 * 60)
    })
    .filter((task) => {
      const key = task.recurrenceSeriesId
        ? `series:${task.recurrenceSeriesId}`
        : `task:${task.projectId ?? task.project}:${task.title.trim().toLocaleLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 20)
}

function taskPriorityWeight(task: Task) {
  return task.priority === 'high' ? 0 : task.priority === 'medium' ? 1 : 2
}

type NowRecommendation = {
  task: Task
  reason: string
  state: 'running' | 'paused' | 'started' | 'current' | 'focus' | 'overdue' | 'next' | 'due'
}

function recommendNowTask(tasks: Task[], now = new Date(), focusTaskId: number | null = null): NowRecommendation | null {
  const today = berlinIsoDate()
  const minutes = berlinClockMinutes(now)
  const openTasks = tasks.filter(isOpenTask)
  const running = openTasks.find((task) => task.focusSession?.status === 'running')
  if (running) return { task: running, reason: '专注已经开始，先留在这一件事里。', state: 'running' }
  const paused = openTasks.find((task) => task.focusSession?.status === 'paused')
  if (paused) return { task: paused, reason: '这次专注正在暂停，准备好后从这里继续。', state: 'paused' }
  const started = openTasks.find((task) => task.status === 'in_progress')
  if (started) return { task: started, reason: '你已经开始了，先把它收尾。', state: 'started' }

  const scheduledToday = openTasks
    .filter((task) => taskCalendarDate(task) === today)
    .sort((left, right) => {
      const leftStart = taskStartMinutes(left) ?? 24 * 60
      const rightStart = taskStartMinutes(right) ?? 24 * 60
      return leftStart - rightStart || taskPriorityWeight(left) - taskPriorityWeight(right)
    })
  const current = scheduledToday.find((task) => {
    const start = taskStartMinutes(task)
    return start !== null && start <= minutes && taskEndMinutes(task) >= minutes
  })
  if (current) return { task: current, reason: '现在正是安排它的时间。', state: 'current' }

  const dailyFocus = focusTaskId === null ? null : openTasks.find((task) => task.id === focusTaskId)
  const dailyFocusStart = dailyFocus ? taskStartMinutes(dailyFocus) : null
  const dailyFocusDate = dailyFocus ? taskCalendarDate(dailyFocus) : null
  if (dailyFocus && (dailyFocus.unscheduled || (dailyFocusDate !== null && dailyFocusDate <= today)) && (dailyFocusStart === null || dailyFocusStart <= minutes)) {
    return { task: dailyFocus, reason: '这是你今天亲自选出的唯一重点。', state: 'focus' }
  }

  const overdue = scheduledToday
    .filter((task) => (taskStartMinutes(task) ?? 24 * 60) < minutes)
    .sort((left, right) => taskPriorityWeight(left) - taskPriorityWeight(right) || (taskStartMinutes(left) ?? 0) - (taskStartMinutes(right) ?? 0))[0]
  if (overdue) return { task: overdue, reason: '它已经到时间了，先清掉这件。', state: 'overdue' }

  const next = scheduledToday.find((task) => (taskStartMinutes(task) ?? -1) >= minutes)
  if (next) return { task: next, reason: '这是今天最近的一项安排。', state: 'next' }

  const due = openTasks
    .filter((task) => task.dueAt && task.dueAt.slice(0, 10) <= today)
    .sort((left, right) => taskPriorityWeight(left) - taskPriorityWeight(right) || (left.dueAt ?? '').localeCompare(right.dueAt ?? ''))[0]
  return due ? { task: due, reason: '它今天到期，值得先处理。', state: 'due' } : null
}

function nextFixedTask(tasks: Task[], currentTaskId: number | null, now = new Date()) {
  const today = berlinIsoDate()
  const minutes = berlinClockMinutes(now)
  return tasks
    .filter((task) => isOpenTask(task)
      && task.id !== currentTaskId
      && task.scheduleMode === 'fixed'
      && taskCalendarDate(task) === today
      && (taskStartMinutes(task) ?? -1) > minutes)
    .sort((left, right) => (taskStartMinutes(left) ?? 24 * 60) - (taskStartMinutes(right) ?? 24 * 60))[0] ?? null
}

function minutesUntilTask(task: Task, now = new Date()) {
  return Math.max(0, (taskStartMinutes(task) ?? berlinClockMinutes(now)) - berlinClockMinutes(now))
}

function ProgressBar({ value, color = '#496d5b' }: { value: number; color?: string }) {
  return (
    <div className="progress-track" aria-label={`进度 ${value}%`}>
      <span style={{ width: `${value}%`, backgroundColor: color }} />
    </div>
  )
}

function Toggle({ checked, onChange, disabled = false }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`switch ${checked ? 'is-on' : ''}`}
      aria-label={checked ? '关闭' : '开启'}
      aria-pressed={checked}
      disabled={disabled}
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

function taskFocusElapsedSeconds(task: Task) {
  const session = task.focusSession
  if (!session) return 0
  const running = session.status === 'running' && session.lastResumedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(session.lastResumedAt)) / 1000))
    : 0
  return Math.max(0, session.elapsedSeconds + running)
}

function CompletionCalibrationModal({ task, onClose, onSave }: { task: Task; onClose: () => void; onSave: (actualMinutes: number) => Promise<void> }) {
  const focusMinutes = taskFocusElapsedSeconds(task) > 0 ? Math.max(1, Math.round(taskFocusElapsedSeconds(task) / 60)) : 0
  const [actualMinutes, setActualMinutes] = useState((task.actualMinutes ?? focusMinutes) || task.duration)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const difference = actualMinutes - task.duration

  function adjust(delta: number) {
    setActualMinutes((current) => Math.max(1, Math.min(1440, current + delta)))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(Math.max(1, Math.min(1440, actualMinutes)))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '完成记录保存失败。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="完成这件事" eyebrow="CALIBRATION" onClose={onClose}>
      <form className="completion-calibration" onSubmit={submit}>
        <div className="completion-task"><span style={{ backgroundColor: task.color }} /><div><strong>{task.title}</strong><small>预计 {task.duration} 分钟{focusMinutes > 0 ? ` · 已计时 ${focusMinutes} 分钟` : ''}</small></div></div>
        <div className="actual-time-field">
          <div><span>实际用了多久？</span><small>确认一次，后续安排会更贴近真实节奏。</small></div>
          <div className="minute-stepper">
            <button type="button" className="icon-button" onClick={() => adjust(-5)} aria-label="减少 5 分钟" title="减少 5 分钟"><Minus size={16} /></button>
            <label><input type="number" min="1" max="1440" value={actualMinutes} onChange={(event) => setActualMinutes(Math.max(1, Math.min(1440, Number(event.target.value) || 1)))} /><span>分钟</span></label>
            <button type="button" className="icon-button" onClick={() => adjust(5)} aria-label="增加 5 分钟" title="增加 5 分钟"><Plus size={16} /></button>
          </div>
        </div>
        <div className={`calibration-difference ${difference === 0 ? 'is-even' : difference > 0 ? 'is-over' : 'is-under'}`}><Clock3 size={16} /><span>{difference === 0 ? '这次估时刚刚好。' : difference > 0 ? `比预计多用了 ${difference} 分钟。` : `比预计少用了 ${Math.abs(difference)} 分钟。`}</span></div>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions"><button type="button" className="outline-button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="primary-button" disabled={saving}><Check size={16} />{saving ? '保存中…' : '确认完成'}</button></footer>
      </form>
    </ModalShell>
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

function AiPlannerModal({ scope, plan, loading, applying, error, onClose, onRetry, onApply }: {
  scope: AiPlanScope
  plan: AiPlan | null
  loading: boolean
  applying: boolean
  error: string
  onClose: () => void
  onRetry: () => void
  onApply: () => void
}) {
  const weekly = scope === 'next_week'
  const rebalancing = scope === 'rebalance'
  const title = weekly ? '准备下周' : rebalancing ? '余下今天' : '整理今天'
  const eyebrow = weekly ? 'WEEKLY PLAN' : rebalancing ? 'ADAPTIVE DAY' : 'SMART PLAN'
  return (
    <ModalShell title={title} eyebrow={eyebrow} onClose={onClose}>
      <div className="ai-plan-body">
        {loading && (
          <div className="ai-plan-loading" role="status">
            <span className="ai-plan-spinner"><Sparkles size={24} /></span>
            <strong>{weekly ? '正在回顾并准备下周' : rebalancing ? '正在重新整理余下今天' : '正在整理今天'}</strong>
            <p>{weekly ? '会根据本周真实节奏给出调整，并避开下周固定安排与吃饭时间。' : rebalancing ? '会保留固定安排、吃饭时间和今晚的结束边界。' : '会避开固定安排、吃饭时间和必要缓冲。'}</p>
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
            {(plan.adjustments ?? []).length > 0 && <div className="ai-adjustments"><span>{weekly ? '下周调整' : rebalancing ? '继续方式' : '执行提示'}</span>{(plan.adjustments ?? []).map((adjustment, index) => <p key={`${index}-${adjustment}`}><strong>{index + 1}</strong>{adjustment}</p>)}</div>}
            <div className="ai-plan-list">
              {plan.items.map((item) => (
                <article className="ai-plan-item" key={item.taskId}>
                  <div className="ai-plan-time"><strong>{aiPlanDateLabel(item.startAt)}</strong>{item.blocks.map((block, index) => <span key={`${item.taskId}-${index}`}>{aiPlanTimeLabel(block.startAt, block.endAt)}</span>)}</div>
                  <span className={`priority priority-${item.priority}`}>{priorityLabels[item.priority]}</span>
                  <div className="ai-plan-copy"><strong>{item.title}</strong><p>{item.reason}</p><small>{item.duration} 分钟</small></div>
                </article>
              ))}
            </div>
            {plan.skipped.length > 0 && (
              <details className="ai-plan-skipped">
                <summary>{rebalancing ? '将移出今天' : '暂未安排'} {plan.skipped.length} 项</summary>
                {plan.skipped.map((item) => <p key={item.taskId}><strong>{item.title}</strong><span>{item.reason}{rebalancing && item.action !== 'keep' ? ` · ${item.action === 'skip' ? '仅跳过本次' : '送回收集箱'}` : ''}</span></p>)}
              </details>
            )}
          </>
        )}
      </div>
      <footer className="modal-actions">
        <button type="button" className="outline-button" onClick={onClose}>{plan ? '暂不采用' : '关闭'}</button>
        {error && <button type="button" className="primary-button" onClick={onRetry}>重新生成</button>}
        {plan && <button type="button" className="primary-button" onClick={onApply} disabled={applying}>{applying ? '写入中…' : rebalancing ? `采用方案 · 保留 ${plan.items.length} 项` : `采用这 ${plan.items.length} 项${weekly ? '下周' : ''}安排`}</button>}
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
  const [isFocus, setIsFocus] = useState(task?.isFocus ?? false)
  const focusActive = task?.focusSession?.status === 'running' || task?.focusSession?.status === 'paused'
  const [recurrenceRule, setRecurrenceRule] = useState(task?.recurrenceRule ?? '')
  const [updateScope, setUpdateScope] = useState<'single' | 'future'>('single')
  const [scheduleMode, setScheduleMode] = useState<'fixed' | 'window' | 'flexible'>(task?.scheduleMode ?? (date ? 'fixed' : 'flexible'))
  const [windowStart, setWindowStart] = useState(task?.windowStart ?? '09:00')
  const [windowEnd, setWindowEnd] = useState(task?.windowEnd ?? '18:00')
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
        isFocus,
        startAt: date ? `${date}T${startTime}:00` : null,
        endAt: date ? `${date}T${endTime}:00` : null,
        dueAt: dueAt || null,
        recurrenceRule: date ? recurrenceRule || null : null,
        updateScope: task?.recurrenceRule ? updateScope : undefined,
        scheduleMode,
        windowStart: scheduleMode === 'window' ? windowStart : null,
        windowEnd: scheduleMode === 'window' ? windowEnd : null,
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
          <div className="focus-task-field full">
            <div><TimerReset size={18} /><span><strong>专注任务</strong><small>{focusActive ? '当前计时结束后才能关闭。' : '开启后可在任务详情中计时，并计入今日专注时长。'}</small></span></div>
            <Toggle checked={isFocus} disabled={focusActive} onChange={() => setIsFocus((current) => !current)} />
          </div>
          <label><span>安排日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <div className="time-pair"><label><span>开始</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} disabled={!date} /></label><label><span>结束</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={!date} /></label></div>
          <label><span>截止时间</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          <label><span>AI 调整方式</span><select value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as 'fixed' | 'window' | 'flexible')}><option value="fixed">固定，不允许移动</option><option value="window">只在时间窗内调整</option><option value="flexible">灵活安排</option></select></label>
          {scheduleMode === 'window' && <div className="time-pair full"><label><span>最早开始</span><input type="time" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} /></label><label><span>最晚结束</span><input type="time" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} /></label></div>}
          <label><span>重复</span><select value={recurrenceRule} onChange={(event) => setRecurrenceRule(event.target.value)} disabled={!date}><option value="">不重复</option><option value="FREQ=DAILY">每天</option><option value="FREQ=WEEKLY">每周</option><option value="FREQ=MONTHLY">每月</option></select></label>
          {task?.recurrenceRule && <label><span>修改范围</span><select value={updateScope} onChange={(event) => setUpdateScope(event.target.value as 'single' | 'future')}><option value="single">仅修改这一次</option><option value="future">这次及以后</option></select></label>}
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

function formatFocusTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

function FocusTimer({ task, idlePermission, onAction }: { task: Task; idlePermission: IdlePermissionState; onAction: (action: FocusAction) => Promise<boolean> }) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<FocusAction | null>(null)
  const session = task.focusSession
  const status = session?.status ?? 'idle'
  const plannedSeconds = Math.max(60, session?.plannedSeconds ?? task.duration * 60)
  const runningSeconds = status === 'running' && session?.lastResumedAt
    ? Math.max(0, Math.floor((now - new Date(session.lastResumedAt).getTime()) / 1000))
    : 0
  const elapsedSeconds = (session?.elapsedSeconds ?? 0) + runningSeconds
  const progress = Math.min(100, Math.round((elapsedSeconds / plannedSeconds) * 100))

  useEffect(() => {
    if (status !== 'running') return undefined
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [status, session?.lastResumedAt])

  async function act(action: FocusAction) {
    setBusy(action)
    try {
      await onAction(action)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={`focus-timer focus-timer-${status}`} aria-label="专注计时">
      <div className="focus-timer-heading">
        <div><TimerReset size={18} /><span><strong>专注计时</strong><small>{status === 'running' ? '正在专注' : status === 'paused' ? '已暂停' : status === 'completed' ? '本次已结束' : '准备开始'}</small></span></div>
        <strong>{progress}%</strong>
      </div>
      <div className="focus-timer-clock"><strong>{formatFocusTime(elapsedSeconds)}</strong><span>/ {formatFocusTime(plannedSeconds)}</span></div>
      <ProgressBar value={progress} color={progress >= 100 ? '#a1843e' : '#496d5b'} />
      <div className="focus-timer-actions">
        {(status === 'idle' || status === 'completed') && <button type="button" className="primary-button" onClick={() => void act('start')} disabled={busy !== null}><Play size={16} />{status === 'completed' ? '再次专注' : '开始专注'}</button>}
        {status === 'running' && <button type="button" className="outline-button" onClick={() => void act('pause')} disabled={busy !== null}><Pause size={16} />暂停</button>}
        {status === 'paused' && <button type="button" className="primary-button" onClick={() => void act('resume')} disabled={busy !== null}><Play size={16} />继续专注</button>}
        {(status === 'running' || status === 'paused') && <button type="button" className="danger-button" onClick={() => void act('end')} disabled={busy !== null}><Square size={15} />结束</button>}
      </div>
      <div className={`focus-idle-status focus-idle-${idlePermission}`}>
        <ShieldCheck size={14} />
        <span>{idlePermission === 'granted'
          ? '离开检测已开启：空闲 10 分钟后会询问'
          : idlePermission === 'denied'
            ? '未获得离开检测权限，请手动暂停'
            : idlePermission === 'unsupported'
              ? '当前浏览器不支持系统离开检测'
              : '首次开始专注时会申请离开检测权限'}</span>
      </div>
    </section>
  )
}

function FocusIdleWarningDialog({ warning, secondsLeft, onContinue, onPause }: {
  warning: FocusIdleWarning
  secondsLeft: number
  onContinue: () => void
  onPause: () => void
}) {
  return (
    <div className="idle-warning-backdrop">
      <section className="idle-warning-dialog" role="alertdialog" aria-modal="true" aria-label="确认是否仍在专注">
        <span className="idle-warning-icon"><AlarmClock size={24} /></span>
        <p className="eyebrow">PRESENCE CHECK</p>
        <h2>还在专注吗？</h2>
        <p>“{warning.taskTitle}”已经连续 10 分钟没有检测到电脑操作。</p>
        <strong className="idle-warning-countdown">{secondsLeft}</strong>
        <span className="idle-warning-caption">秒后自动暂停，并扣除离开时间</span>
        <ProgressBar value={Math.round((secondsLeft / focusIdleConfirmationSeconds) * 100)} color="#a1843e" />
        <div className="idle-warning-actions">
          <button type="button" className="outline-button" onClick={onPause}><Pause size={16} />立即暂停</button>
          <button type="button" className="primary-button" onClick={onContinue}><Check size={16} />我还在，继续专注</button>
        </div>
      </section>
    </div>
  )
}

function TaskDetail({ task, idlePermission, onClose, onEdit, onSchedule, onDelete, onToggle, onStart, onComplete, onSnooze, onRescue, onToggleSubtask, onFocusAction, onSkipOccurrence, onPauseSeries }: {
  task: Task
  idlePermission: IdlePermissionState
  onClose: () => void
  onEdit: () => void
  onSchedule: () => void
  onDelete: () => Promise<void>
  onToggle: () => void
  onStart: () => Promise<void>
  onComplete: () => void
  onSnooze: (minutes: 10 | 30) => Promise<void>
  onRescue: () => void
  onToggleSubtask: (subtask: Subtask) => void
  onFocusAction: (action: FocusAction) => Promise<boolean>
  onSkipOccurrence: () => Promise<void>
  onPauseSeries: (date: string) => Promise<void>
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pauseDate, setPauseDate] = useState(shiftIsoDate(berlinIsoDate(), 1))
  const [recurrenceBusy, setRecurrenceBusy] = useState(false)
  const [quickBusy, setQuickBusy] = useState<'start' | 'snooze-10' | 'snooze-30' | null>(null)
  const sessionActive = task.focusSession?.status === 'running' || task.focusSession?.status === 'paused'
  const startDisabled = quickBusy !== null || task.focusSession?.status === 'running' || (task.status === 'in_progress' && !task.isFocus && task.focusSession?.sessionType !== 'rescue')
  const startLabel = task.focusSession?.sessionType === 'rescue'
    ? task.focusSession.status === 'paused' ? '继续救援' : '救援进行中'
    : task.isFocus
      ? task.focusSession?.status === 'paused' ? '继续专注' : task.focusSession?.status === 'running' ? '专注进行中' : '开始专注'
      : task.status === 'in_progress' ? '任务进行中' : '开始任务'

  async function remove() {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  async function runQuickAction(action: 'start' | 'snooze-10' | 'snooze-30', callback: () => Promise<void>) {
    setQuickBusy(action)
    try {
      await callback()
    } finally {
      setQuickBusy(null)
    }
  }

  return (
    <ModalShell title={task.title} eyebrow="TASK DETAIL" onClose={onClose}>
      <div className="task-detail">
        {!task.completed && !task.skipped && (
          <section className="task-quick-actions" aria-label="任务快速处理">
            <div className="task-quick-heading">
              <div><Smartphone size={17} /><span><strong>快速处理</strong><small>{task.reminderAt ? `下次提醒 ${taskMoment(task.reminderAt)}` : task.startAt ? '提醒已送达' : '先开始，或安排一个时间'}</small></span></div>
              <span className={`task-quick-state ${task.status === 'in_progress' ? 'active' : ''}`}>{task.status === 'in_progress' ? '进行中' : '待处理'}</span>
            </div>
            <div className="task-quick-primary">
              <button type="button" className="primary-button" disabled={startDisabled} onClick={() => void runQuickAction('start', onStart)}><Play size={16} />{quickBusy === 'start' ? '启动中…' : startLabel}</button>
              <button type="button" className="outline-button" disabled={quickBusy !== null} onClick={onComplete}><Check size={16} />完成</button>
            </div>
            <div className="task-quick-secondary">
              {task.startAt ? <>
                <span><AlarmClock size={15} />稍后提醒</span>
                <button type="button" className="outline-button compact" disabled={quickBusy !== null} onClick={() => void runQuickAction('snooze-10', () => onSnooze(10))}>{quickBusy === 'snooze-10' ? '设置中…' : '10 分钟'}</button>
                <button type="button" className="outline-button compact" disabled={quickBusy !== null} onClick={() => void runQuickAction('snooze-30', () => onSnooze(30))}>{quickBusy === 'snooze-30' ? '设置中…' : '30 分钟'}</button>
              </> : <button type="button" className="outline-button compact" onClick={onSchedule}><CalendarClock size={15} />安排时间</button>}
              <button type="button" className="text-button task-quick-rescue" disabled={quickBusy !== null || sessionActive} onClick={onRescue}><Sparkles size={15} />有点难开始</button>
            </div>
          </section>
        )}

        <div className={`task-detail-status ${task.completed ? 'is-complete' : ''} ${task.skipped ? 'is-skipped' : ''}`}>
          <TaskCheck task={task} onToggle={onToggle} />
          <button type="button" onClick={onToggle} disabled={task.skipped}><strong>{task.skipped ? '已跳过' : task.completed ? '已完成' : '标记为完成'}</strong><small>{task.skipped ? '保留在历史中，不计入完成率' : task.completed ? '再次点击可恢复任务' : '完成后会保留这次记录'}</small></button>
        </div>

        <div className="task-detail-meta">
          <div><CalendarClock size={17} /><span>时间</span><strong>{taskScheduleLabel(task)}</strong></div>
          <div><Clock3 size={17} /><span>{task.completed && task.actualMinutes ? '预计 / 实际' : '预计'}</span><strong>{task.completed && task.actualMinutes ? `${task.duration} / ${task.actualMinutes} 分钟` : `${task.duration} 分钟`}</strong></div>
          <div><FolderKanban size={17} /><span>项目</span><strong>{task.project}</strong></div>
          <div><Repeat2 size={17} /><span>重复</span><strong>{recurrenceLabel(task.recurrenceRule)}</strong></div>
        </div>

        {(task.scheduleBlocks?.length ?? 0) > 1 && (
          <section className="task-detail-section">
            <div className="task-detail-heading"><h3>专注区块</h3><span>共 {task.scheduleBlocks?.length} 段</span></div>
            <div className="schedule-block-list">
              {task.scheduleBlocks?.map((block, index) => <div key={block.id}><strong>第 {index + 1} 段</strong><span>{taskMoment(block.startAt)}–{block.end}</span></div>)}
            </div>
          </section>
        )}

        {task.isFocus && <FocusTimer task={task} idlePermission={idlePermission} onAction={onFocusAction} />}

        {task.recurrenceRule && !task.completed && !task.skipped && (
          <section className="task-detail-section recurrence-controls">
            <div className="task-detail-heading"><h3>循环任务</h3><span>{task.recurrencePausedUntil ? `暂停至 ${task.recurrencePausedUntil}` : recurrenceLabel(task.recurrenceRule)}</span></div>
            <div className="recurrence-actions">
              <button type="button" className="outline-button" disabled={recurrenceBusy} onClick={async () => { setRecurrenceBusy(true); try { await onSkipOccurrence() } finally { setRecurrenceBusy(false) } }}>跳过这一次</button>
              <label><span>暂停到</span><input type="date" min={shiftIsoDate(berlinIsoDate(), 1)} value={pauseDate} onChange={(event) => setPauseDate(event.target.value)} /></label>
              <button type="button" className="outline-button" disabled={recurrenceBusy} onClick={async () => { setRecurrenceBusy(true); try { await onPauseSeries(pauseDate) } finally { setRecurrenceBusy(false) } }}><Pause size={15} />暂停系列</button>
            </div>
          </section>
        )}

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
      className={`task-check ${task.completed ? 'checked' : ''} ${task.skipped ? 'skipped' : ''}`}
      onClick={() => onToggle(task.id)}
      disabled={task.skipped}
      aria-label={task.skipped ? '已跳过' : task.completed ? '标记为未完成' : '标记为完成'}
    >
      {task.completed && <Check size={14} strokeWidth={3} />}
    </button>
  )
}

function NowPage({ tasks, dailyRhythm, idlePermission, onStart, onPause, onComplete, onDelay, onSkip, onOpenTask, onNavigate, onRebalance, onOpenRescue, onFinishRescue }: {
  tasks: Task[]
  dailyRhythm: DailyRhythm
  idlePermission: IdlePermissionState
  onStart: (task: Task) => Promise<void>
  onPause: (task: Task) => Promise<void>
  onComplete: (task: Task) => Promise<void>
  onDelay: (task: Task, minutes: number) => Promise<void>
  onSkip: (task: Task) => Promise<void>
  onOpenTask: (id: number) => void
  onNavigate: (page: PageKey) => void
  onRebalance: () => void
  onOpenRescue: (task: Task) => void
  onFinishRescue: (task: Task, outcome: RescueOutcome) => Promise<void>
}) {
  const [clock, setClock] = useState(Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const recommendation = recommendNowTask(tasks, new Date(clock), dailyRhythm.focusTaskId)
  const task = recommendation?.task ?? null
  const nextFixed = nextFixedTask(tasks, task?.id ?? null, new Date(clock))
  const todayQueue = tasks
    .filter((item) => isOpenTask(item) && item.id !== task?.id && taskCalendarDate(item) === berlinIsoDate())
    .sort((left, right) => (taskStartMinutes(left) ?? 24 * 60) - (taskStartMinutes(right) ?? 24 * 60))
    .slice(0, 4)
  const session = task?.focusSession
  const rescueSession = session?.sessionType === 'rescue' && (session.status === 'running' || session.status === 'paused') ? session : null
  const rescueActive = rescueSession !== null
  const runningSeconds = session?.status === 'running' && session.lastResumedAt
    ? Math.max(0, Math.floor((clock - new Date(session.lastResumedAt).getTime()) / 1000))
    : 0
  const elapsedSeconds = (session?.elapsedSeconds ?? 0) + runningSeconds
  const plannedSeconds = Math.max(60, session?.plannedSeconds ?? (task?.duration ?? 1) * 60)
  const focusProgress = Math.min(100, Math.round((elapsedSeconds / plannedSeconds) * 100))

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), task?.focusSession?.status === 'running' ? 1000 : 30_000)
    return () => window.clearInterval(interval)
  }, [task?.focusSession?.status])

  async function act(key: string, action: () => Promise<void>) {
    setBusy(key)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  if (!task || !recommendation) {
    return (
      <div className="page-content now-page">
        <section className="page-heading">
          <div><p className="eyebrow">NOW</p><h1>现在该做什么</h1><p>{berlinDate()}，只看眼前这一小步。</p></div>
        </section>
        <section className="now-empty">
          <span><CheckCircle2 size={28} /></span>
          <h2>现在没有必须处理的事</h2>
          <p>今天的安排已经完成，或者还没有给任务安排时间。可以放心休息，也可以整理一下今天。</p>
          <div><button type="button" className="primary-button" onClick={() => onNavigate('today')}>查看今日</button><button type="button" className="outline-button" onClick={() => onNavigate('inbox')}>打开收集箱</button></div>
        </section>
      </div>
    )
  }

  const startLabel = task.isFocus
    ? session?.status === 'paused' ? '继续专注' : '开始专注'
    : task.status === 'in_progress' ? '进行中' : '开始行动'
  const scheduleLabel = task.start ? `${task.start}–${task.end ?? ''}` : task.dueAt ? `截止 ${taskMoment(task.dueAt)}` : '未设置具体时间'
  const nextFixedMinutes = nextFixed ? minutesUntilTask(nextFixed, new Date(clock)) : null

  return (
    <div className="page-content now-page">
      <section className="page-heading now-heading">
        <div><p className="eyebrow">NOW</p><h1>现在该做什么</h1><p>{berlinDate()}，系统已经替你缩小到一件事。</p></div>
        <div className="now-heading-actions"><button type="button" className="outline-button rebalance-trigger" onClick={onRebalance}><RefreshCcw size={15} />重排余下</button><button type="button" className="outline-button" onClick={() => onNavigate('today')}>查看整天 <ChevronRight size={15} /></button></div>
      </section>

      <div className="now-layout">
        <main className="now-stage" aria-live="polite">
          <div className="now-state-line">
            <span className={`now-state now-state-${rescueActive ? 'rescue' : recommendation.state}`}>{rescueActive ? '启动救援' : recommendation.state === 'running' ? '正在专注' : recommendation.state === 'paused' ? '已暂停' : recommendation.state === 'started' ? '正在进行' : recommendation.state === 'focus' ? '今日重点' : recommendation.state === 'overdue' ? '已经到点' : recommendation.state === 'current' ? '就是现在' : '接下来'}</span>
            <span>{rescueSession ? `卡点：${rescueReasonLabels[rescueSession.rescueReason ?? 'unclear']}` : recommendation.reason}</span>
          </div>
          <div className="now-task-heading">
            <span className="now-task-color" style={{ backgroundColor: task.color }} />
            <div><p>{task.project} · {task.category}</p><h2>{task.title}</h2></div>
            <button type="button" className="row-action" onClick={() => onOpenTask(task.id)} aria-label="查看任务详情" title="查看任务详情"><MoreHorizontal size={19} /></button>
          </div>
          <div className="now-task-meta">
            <span><CalendarClock size={16} />{scheduleLabel}</span>
            <span><Clock3 size={16} />预计 {task.duration} 分钟</span>
            {task.isFocus && <span><TimerReset size={16} />专注任务</span>}
            {task.scheduleMode === 'fixed' && <span><LockKeyhole size={16} />固定安排</span>}
          </div>

          {task.notes && <p className="now-task-note">{task.notes}</p>}

          {rescueSession && (
            <section className={`rescue-active-panel rescue-active-${rescueSession.status}`} aria-label="启动救援计时">
              <div className="rescue-active-heading"><div><Sparkles size={18} /><span><small>现在只做这一小步</small><strong>{rescueSession.rescueStep}</strong></span></div><strong>{focusProgress}%</strong></div>
              <p><strong>{formatFocusTime(elapsedSeconds)}</strong><span>/ {formatFocusTime(plannedSeconds)}</span></p>
              <ProgressBar value={focusProgress} color={focusProgress >= 100 ? '#a1843e' : '#b96552'} />
              <small><ShieldCheck size={13} />{focusProgress >= 100 ? '这一步已经到点，现在只决定继续还是稍后。' : idlePermission === 'granted' ? '离开检测已开启' : '救援开始时会尝试开启离开检测'}</small>
            </section>
          )}

          {task.isFocus && !rescueActive && (
            <section className="now-focus-progress" aria-label="当前专注进度">
              <div><span>{session?.status === 'running' ? '专注中' : session?.status === 'paused' ? '专注已暂停' : '准备开始'}</span><strong>{focusProgress}%</strong></div>
              <p><strong>{formatFocusTime(elapsedSeconds)}</strong><span>/ {formatFocusTime(plannedSeconds)}</span></p>
              <ProgressBar value={focusProgress} color={focusProgress >= 100 ? '#a1843e' : '#496d5b'} />
              <small><ShieldCheck size={13} />{idlePermission === 'granted' ? '离开检测已开启' : '开始专注时会尝试开启离开检测'}</small>
            </section>
          )}

          <div className="now-primary-actions">
            {rescueSession?.status === 'running' ? (
              <button type="button" className="outline-button" disabled={busy !== null} onClick={() => void act('pause', () => onPause(task))}><Pause size={17} />暂停</button>
            ) : rescueSession?.status === 'paused' ? (
              <button type="button" className="outline-button" disabled={busy !== null} onClick={() => void act('resume', () => onStart(task))}><Play size={17} />继续这一步</button>
            ) : task.isFocus && session?.status === 'running' ? (
              <button type="button" className="outline-button" disabled={busy !== null} onClick={() => void act('pause', () => onPause(task))}><Pause size={17} />暂停</button>
            ) : task.status !== 'in_progress' || task.isFocus ? (
              <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void act('start', () => onStart(task))}><Play size={17} />{startLabel}</button>
            ) : null}
            {rescueActive ? <>
              <button type="button" className="primary-button rescue-continue-button" disabled={busy !== null} onClick={() => void act('rescue-continue', () => onFinishRescue(task, 'continue'))}><Play size={17} />继续原任务</button>
              <button type="button" className="outline-button" disabled={busy !== null} onClick={() => void act('rescue-later', () => onFinishRescue(task, 'later'))}><Clock3 size={17} />稍后 30 分钟</button>
            </> : <>
              <button type="button" className="outline-button rescue-open-button" disabled={busy !== null || session?.status === 'running' || session?.status === 'paused'} onClick={() => onOpenRescue(task)}><Sparkles size={17} />有点难开始</button>
              <button type="button" className="primary-button now-complete-button" disabled={busy !== null} onClick={() => void act('complete', () => onComplete(task))}><Check size={17} />完成，下一项</button>
            </>}
          </div>

          {!rescueActive && <div className="now-secondary-actions">
            <span>稍后再做</span>
            {[15, 30, 60].map((minutes) => <button type="button" className="outline-button compact" disabled={busy !== null} onClick={() => void act(`delay-${minutes}`, () => onDelay(task, minutes))} key={minutes}>{minutes} 分钟</button>)}
            <button type="button" className="text-button now-skip-button" disabled={busy !== null} onClick={() => void act('skip', () => onSkip(task))}>{task.recurrenceRule ? '跳过今天' : '移出今天'}</button>
          </div>}
        </main>

        <aside className="now-aside">
          <section>
            <div className="section-title-row"><h2>下一固定安排</h2></div>
            {nextFixed ? (
              <button type="button" className="now-fixed-task" onClick={() => onOpenTask(nextFixed.id)}>
                <span>{nextFixed.start}</span><div><strong>{nextFixed.title}</strong><small>{nextFixedMinutes !== null && nextFixedMinutes >= 60 ? `${Math.floor(nextFixedMinutes / 60)} 小时 ${nextFixedMinutes % 60} 分钟后` : `${nextFixedMinutes} 分钟后`}</small></div><ChevronRight size={15} />
              </button>
            ) : <p className="empty-copy">今天没有后续固定安排。</p>}
          </section>
          <section>
            <div className="section-title-row"><h2>今天后面还有</h2><span>{todayQueue.length} 项</span></div>
            <div className="now-queue">
              {todayQueue.map((item) => (
                <button type="button" onClick={() => onOpenTask(item.id)} key={item.id}>
                  <span>{item.start ?? '待定'}</span><div><strong>{item.title}</strong><small>{item.duration} 分钟{item.isFocus ? ' · 专注' : ''}</small></div>
                </button>
              ))}
              {todayQueue.length === 0 && <p className="empty-copy">做完这一项，今天就清静了。</p>}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function EnergyScale({ value, onChange, label }: { value: number; onChange: (value: number) => void; label: string }) {
  const labels = ['', '很低', '偏低', '一般', '不错', '很好']

  return (
    <fieldset className="energy-field">
      <legend>{label}</legend>
      <div className="energy-scale">
        {[1, 2, 3, 4, 5].map((level) => (
          <button type="button" className={value === level ? 'active' : ''} aria-pressed={value === level} onClick={() => onChange(level)} key={level}>
            <strong>{level}</strong><span>{labels[level]}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function RebalanceSetupModal({ tasks, dailyRhythm, settings, onClose, onGenerate }: {
  tasks: Task[]
  dailyRhythm: DailyRhythm
  settings: UserSettings
  onClose: () => void
  onGenerate: (input: RebalanceInput) => void
}) {
  const initialEnergy = dailyRhythm.morningEnergy ?? 3
  const [currentEnergy, setCurrentEnergy] = useState(initialEnergy)
  const [mode, setMode] = useState<RebalanceInput['mode']>(initialEnergy <= 2 ? 'low_energy' : 'normal')
  const [latestEnd, setLatestEnd] = useState(settings.planningEndTime)
  const [error, setError] = useState('')
  const remaining = tasks.filter((task) => isOpenTask(task) && taskCalendarDate(task) === berlinIsoDate() && task.scheduleMode !== 'fixed')
  const fixed = tasks.filter((task) => isOpenTask(task) && taskCalendarDate(task) === berlinIsoDate() && task.scheduleMode === 'fixed').length
  const remainingMinutes = remaining.reduce((sum, task) => sum + task.duration, 0)

  function submit(event: FormEvent) {
    event.preventDefault()
    const [endHour, endMinute] = latestEnd.split(':').map(Number)
    if (endHour * 60 + endMinute <= berlinClockMinutes() + 15) {
      setError('最晚结束时间至少需要比现在晚 15 分钟。')
      return
    }
    onGenerate({ mode, currentEnergy, latestEnd })
  }

  return (
    <ModalShell title="重新整理余下今天" eyebrow="ADAPTIVE DAY" onClose={onClose}>
      <form className="rebalance-setup" onSubmit={submit}>
        <div className="rebalance-overview">
          <span><RefreshCcw size={20} /></span>
          <div><strong>{remaining.length} 项可以重排</strong><p>约 {Math.floor(remainingMinutes / 60)} 小时 {remainingMinutes % 60} 分钟{fixed > 0 ? ` · ${fixed} 项固定安排会保留` : ''}</p></div>
        </div>
        <fieldset className="rebalance-mode-field">
          <legend>今天接下来怎么走？</legend>
          <div className="rebalance-mode-control">
            <button type="button" className={mode === 'normal' ? 'active' : ''} aria-pressed={mode === 'normal'} onClick={() => setMode('normal')}><RefreshCcw size={18} /><span><strong>正常继续</strong><small>保留现实可完成的重点</small></span></button>
            <button type="button" className={mode === 'low_energy' ? 'active' : ''} aria-pressed={mode === 'low_energy'} onClick={() => setMode('low_energy')}><BatteryMedium size={18} /><span><strong>低能量保底</strong><small>主动减负，只留最重要的</small></span></button>
          </div>
        </fieldset>
        <EnergyScale value={currentEnergy} onChange={setCurrentEnergy} label="现在还有多少精力？" />
        <label className="rebalance-end-field"><span><Clock3 size={16} />今晚最晚结束</span><input type="time" value={latestEnd} onChange={(event) => { setLatestEnd(event.target.value); setError('') }} /></label>
        {dailyRhythm.focusTaskTitle && <div className="rebalance-focus-note"><Flag size={15} /><span>今日重点：<strong>{dailyRhythm.focusTaskTitle}</strong></span></div>}
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>取消</button><button type="submit" className="primary-button"><Sparkles size={16} />生成余下方案</button></footer>
      </form>
    </ModalShell>
  )
}

function RescueSetupModal({ task, onClose, onStart }: {
  task: Task
  onClose: () => void
  onStart: (input: RescueInput) => Promise<void>
}) {
  const [reason, setReason] = useState<RescueReason | null>(null)
  const [step, setStep] = useState('')
  const [durationMinutes, setDurationMinutes] = useState<RescueInput['durationMinutes']>(5)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const reasons = [
    { key: 'low_energy' as const, label: rescueReasonLabels.low_energy, detail: '把启动成本降到最低', icon: BatteryMedium },
    { key: 'too_big' as const, label: rescueReasonLabels.too_big, detail: '只取第一小步', icon: Target },
    { key: 'unclear' as const, label: rescueReasonLabels.unclear, detail: '先弄清唯一下一步', icon: Search },
    { key: 'not_convenient' as const, label: rescueReasonLabels.not_convenient, detail: '先完成准备动作', icon: Clock3 },
  ]

  function chooseReason(nextReason: RescueReason) {
    setReason(nextReason)
    setStep(suggestedRescueStep(task, nextReason))
    setDurationMinutes(nextReason === 'low_energy' || nextReason === 'not_convenient' ? 2 : 5)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!reason || !step.trim()) {
      setError('先选一个卡点，并保留一个可以立刻开始的小动作。')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onStart({ reason, step: step.trim(), durationMinutes })
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : '暂时无法开始救援计时。')
      setSaving(false)
    }
  }

  return (
    <ModalShell title="先让自己动起来" eyebrow="START RESCUE" onClose={onClose}>
      <form className="rescue-setup" onSubmit={submit}>
        <div className="rescue-task-summary"><span style={{ backgroundColor: task.color }} /><div><small>眼前的任务</small><strong>{task.title}</strong></div></div>
        <fieldset className="rescue-reason-field">
          <legend>现在卡在哪里？</legend>
          <div className="rescue-reason-grid">
            {reasons.map(({ key, label, detail, icon: Icon }) => <button type="button" className={reason === key ? 'active' : ''} aria-pressed={reason === key} onClick={() => chooseReason(key)} key={key}><Icon size={18} /><span><strong>{label}</strong><small>{detail}</small></span></button>)}
          </div>
        </fieldset>
        {reason && <div className="rescue-step-editor">
          <label><span>现在只做这一小步</span><input autoFocus maxLength={255} value={step} onChange={(event) => setStep(event.target.value)} /></label>
          <fieldset><legend>先做多久？</legend><div>{([2, 5, 10] as const).map((minutes) => <button type="button" className={durationMinutes === minutes ? 'active' : ''} aria-pressed={durationMinutes === minutes} onClick={() => setDurationMinutes(minutes)} key={minutes}>{minutes} 分钟</button>)}</div></fieldset>
        </div>}
        <p className="rescue-reassurance">这不是缩短原任务，也不要求一次做完。先启动，时间到了再决定下一步。</p>
        {error && <p className="form-error">{error}</p>}
        <footer className="modal-actions"><button type="button" className="outline-button" onClick={onClose} disabled={saving}>取消</button><button type="submit" className="primary-button" disabled={saving || !reason || !step.trim()}><Play size={16} />{saving ? '启动中…' : `先做 ${durationMinutes} 分钟`}</button></footer>
      </form>
    </ModalShell>
  )
}

function MorningCheckinModal({ rhythm, tasks, onClose, onSave, onSkip }: {
  rhythm: DailyRhythm
  tasks: Task[]
  onClose: () => void
  onSave: (input: MorningCheckinInput, organize: boolean) => Promise<void>
  onSkip: () => Promise<void>
}) {
  const taskOptions = morningFocusTaskOptions(tasks)
  const recommendedTaskId = rhythm.focusTaskId ?? recommendNowTask(tasks)?.task.id ?? null
  const suggestedTaskId = recommendedTaskId !== null && taskOptions.some((task) => task.id === recommendedTaskId)
    ? recommendedTaskId
    : taskOptions[0]?.id ?? null
  const [wakeTime, setWakeTime] = useState(rhythm.wakeTime ?? berlinClockTime())
  const [hadBreakfast, setHadBreakfast] = useState(rhythm.hadBreakfast ?? false)
  const [energy, setEnergy] = useState(rhythm.morningEnergy ?? 3)
  const [focusTaskId, setFocusTaskId] = useState(suggestedTaskId === null ? '' : String(suggestedTaskId))
  const [busy, setBusy] = useState<'save' | 'organize' | 'skip' | null>(null)
  const [error, setError] = useState('')

  async function save(organize: boolean) {
    setBusy(organize ? 'organize' : 'save')
    setError('')
    try {
      await onSave({ wakeTime, hadBreakfast, energy, focusTaskId: focusTaskId ? Number(focusTaskId) : null }, organize)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '晨间启动保存失败。')
    } finally {
      setBusy(null)
    }
  }

  async function skip() {
    setBusy('skip')
    setError('')
    try {
      await onSkip()
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : '暂时无法跳过晨间启动。')
    } finally {
      setBusy(null)
    }
  }

  return (
    <ModalShell title="开始今天" eyebrow="MORNING" onClose={onClose}>
      <div className="daily-flow-body">
        <div className="daily-flow-intro"><span><Sunrise size={22} /></span><div><strong>不用规划完美的一天</strong><p>只记录此刻状态，再选出今天唯一重要的一件事。</p></div></div>
        <div className="morning-basics">
          <label><span>今天几点起床？</span><input type="time" value={wakeTime} onChange={(event) => setWakeTime(event.target.value)} /></label>
          <fieldset><legend>吃早饭了吗？</legend><div className="binary-choice"><button type="button" className={hadBreakfast ? 'active' : ''} onClick={() => setHadBreakfast(true)}><Coffee size={15} />吃了</button><button type="button" className={!hadBreakfast ? 'active' : ''} onClick={() => setHadBreakfast(false)}>还没有</button></div></fieldset>
        </div>
        <EnergyScale value={energy} onChange={setEnergy} label="现在的精力怎么样？" />
        <label className="daily-focus-select"><span><Flag size={15} />今天唯一必须完成</span><select value={focusTaskId} onChange={(event) => setFocusTaskId(event.target.value)}><option value="">暂时不选</option>{taskOptions.map((task) => <option value={task.id} key={task.id}>{taskCalendarDate(task) === berlinIsoDate() && task.start ? `${task.start} · ` : ''}{task.title}</option>)}</select></label>
        <div className="daily-streak-note"><Sun size={15} /><span>晨间启动已连续完成 <strong>{rhythm.morningStreak}</strong> 天。跳过不会产生惩罚。</span></div>
        {error && <p className="form-error">{error}</p>}
      </div>
      <footer className="modal-actions daily-flow-actions">
        <button type="button" className="text-button" disabled={busy !== null} onClick={() => void skip()}>{busy === 'skip' ? '处理中…' : '今天先跳过'}</button>
        <button type="button" className="outline-button" disabled={busy !== null || !wakeTime} onClick={() => void save(true)}><Sparkles size={16} />{busy === 'organize' ? '保存中…' : '保存并整理今天'}</button>
        <button type="button" className="primary-button" disabled={busy !== null || !wakeTime} onClick={() => void save(false)}>{busy === 'save' ? '保存中…' : '开始今天'}</button>
      </footer>
    </ModalShell>
  )
}

function EveningCheckinModal({ rhythm, tasks, onClose, onSave }: {
  rhythm: DailyRhythm
  tasks: Task[]
  onClose: () => void
  onSave: (energy: number, reflection: string, decisions: EveningDecision[]) => Promise<void>
}) {
  const today = berlinIsoDate()
  const relevantTasks = tasks.filter((task) => !task.skipped && task.status !== 'cancelled' && (
    taskCalendarDate(task) === today
    || task.completedAt?.slice(0, 10) === today
    || task.status === 'in_progress'
    || task.dueAt?.slice(0, 10) === today
  ))
  const unfinished = relevantTasks.filter((task) => !task.completed)
  const completed = relevantTasks.filter((task) => task.completed).length
  const focusSeconds = relevantTasks.reduce((sum, task) => {
    const session = task.focusSession
    if (!session) return sum
    const runningSeconds = session.status === 'running' && session.lastResumedAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(session.lastResumedAt)) / 1000))
      : 0
    return sum + session.elapsedSeconds + runningSeconds
  }, 0)
  const [energy, setEnergy] = useState(rhythm.eveningEnergy ?? 3)
  const [reflection, setReflection] = useState(rhythm.reflection)
  const [decisions, setDecisions] = useState<Record<number, EveningDecision['action']>>(() => Object.fromEntries(unfinished.map((task) => [task.id, task.recurrenceRule ? 'drop' : 'tomorrow'])))
  const [reasons, setReasons] = useState<Partial<Record<number, FailureReason>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (unfinished.some((task) => !reasons[task.id])) {
      setError('请为每个未完成任务选择一个原因。')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSave(energy, reflection, unfinished.map((task) => ({ taskId: task.id, action: decisions[task.id] ?? 'later', reason: reasons[task.id] as FailureReason })))
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '今晚收尾保存失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalShell title="结束今天" eyebrow="EVENING" onClose={onClose}>
      <div className="daily-flow-body evening-flow-body">
        <div className="daily-flow-intro"><span><Sunset size={22} /></span><div><strong>今天到这里就够了</strong><p>把没做完的事情放到合适的位置，然后安心结束今天。</p></div></div>
        <div className="evening-summary">
          <div><strong>{completed}</strong><span>完成任务</span></div><div><strong>{formatFocusTime(focusSeconds).slice(0, 5)}</strong><span>真实专注</span></div><div><strong>{unfinished.length}</strong><span>需要决定</span></div>
        </div>
        {unfinished.length > 0 && <section className="unfinished-decisions"><div className="task-detail-heading"><h3>未完成任务</h3><span>逐项选择去向</span></div>{unfinished.map((task) => (
          <article key={task.id}>
            <div><span style={{ backgroundColor: task.color }} /><div><strong>{task.title}</strong><small>{task.start ?? '待安排'} · {task.duration} 分钟{task.recurrenceRule ? ' · 循环' : ''}</small></div></div>
            <div className="decision-stack">
              <div className="decision-control">
                <button type="button" className={decisions[task.id] === 'tomorrow' ? 'active' : ''} onClick={() => setDecisions((current) => ({ ...current, [task.id]: 'tomorrow' }))}>明天</button>
                <button type="button" className={decisions[task.id] === 'later' ? 'active' : ''} onClick={() => setDecisions((current) => ({ ...current, [task.id]: 'later' }))}>以后</button>
                <button type="button" className={decisions[task.id] === 'drop' ? 'active' : ''} onClick={() => setDecisions((current) => ({ ...current, [task.id]: 'drop' }))}>{task.recurrenceRule ? '跳过' : '放弃'}</button>
              </div>
              <label className="failure-reason-field"><span>未完成原因</span><select value={reasons[task.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [task.id]: event.target.value as FailureReason }))}><option value="">请选择</option>{failureReasonOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            </div>
          </article>
        ))}</section>}
        {unfinished.length === 0 && <div className="evening-clear"><CheckCircle2 size={20} /><div><strong>今天没有遗留任务</strong><span>现在可以直接收尾。</span></div></div>}
        <EnergyScale value={energy} onChange={setEnergy} label="今晚还剩多少精力？" />
        <label className="reflection-field"><span>给今天留一句话（可选）</span><textarea maxLength={2000} value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="今天什么做得不错，或者明天想记住什么？" /></label>
        <div className="daily-streak-note"><Moon size={15} /><span>晚间收尾已连续完成 <strong>{rhythm.eveningStreak}</strong> 天。结束后停止今天剩余的普通邮件提醒。</span></div>
        {error && <p className="form-error">{error}</p>}
      </div>
      <footer className="modal-actions daily-flow-actions"><button type="button" className="outline-button" onClick={onClose} disabled={busy}>稍后再说</button><button type="button" className="primary-button" onClick={() => void submit()} disabled={busy}>{busy ? '收尾中…' : '确认并结束今天'}</button></footer>
    </ModalShell>
  )
}

function TodayPage({ tasks, habits, projects, dailyRhythm, quickEntry, setQuickEntry, addTask, toggleTask, toggleHabit, onOpenTask, onScheduleTask, onNavigate, onRebalance, onOpenDailyFlow }: {
  tasks: Task[]
  habits: Habit[]
  projects: Project[]
  dailyRhythm: DailyRhythm
  quickEntry: string
  setQuickEntry: (value: string) => void
  addTask: () => void
  toggleTask: (id: number) => void
  toggleHabit: (id: number, day: number) => void
  onOpenTask: (id: number) => void
  onScheduleTask: (id: number) => void
  onNavigate: (page: PageKey) => void
  onRebalance: () => void
  onOpenDailyFlow: () => void
}) {
  const scheduled = tasks
    .filter((task) => !task.unscheduled && taskCalendarDate(task) === berlinIsoDate())
    .sort((left, right) => (taskCalendarTime(left) ?? '').localeCompare(taskCalendarTime(right) ?? ''))
  const activeScheduled = scheduled.filter((task) => !task.skipped)
  const completed = activeScheduled.filter((task) => task.completed).length
  const progress = Math.round((completed / Math.max(activeScheduled.length, 1)) * 100)
  const plannedMinutes = activeScheduled.reduce((sum, task) => sum + task.duration, 0)
  const focusMinutes = activeScheduled.filter((task) => task.isFocus).reduce((sum, task) => sum + task.duration, 0)
  const nextTask = activeScheduled.find((task) => !task.completed)
  const todayIndex = Array.from({ length: 7 }, (_, index) => currentWeekDateIso(index)).indexOf(berlinIsoDate())
  const rhythmLabel = activeScheduled.length === 0 ? '暂无安排' : progress >= 75 ? '很顺畅' : progress >= 30 ? '推进中' : '刚开始'
  const rhythmNote = activeScheduled.length === 0
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
          <button type="button" className="outline-button daily-flow-trigger" onClick={onOpenDailyFlow} disabled={Boolean(dailyRhythm.closedAt)}>{dailyRhythm.closedAt ? <CheckCircle2 size={17} /> : dailyRhythm.morningStatus === 'pending' ? <Sunrise size={17} /> : <Sunset size={17} />}{dailyRhythm.closedAt ? '今日已收尾' : dailyRhythm.morningStatus === 'pending' ? '开始今天' : '结束今天'}</button>
          <button type="button" className="outline-button ai-plan-trigger rebalance-trigger" onClick={onRebalance}><RefreshCcw size={17} /> 重排余下</button>
          <div className="today-progress">
            <strong>{progress}%</strong>
            <span>今日进度</span>
            <ProgressBar value={progress} />
          </div>
        </div>
      </section>

      <CaptureBar value={quickEntry} onChange={setQuickEntry} onAdd={addTask} />

      {dailyRhythm.focusTaskId && dailyRhythm.focusTaskTitle && !dailyRhythm.closedAt && (
        <button type="button" className="daily-focus-banner" onClick={() => onOpenTask(dailyRhythm.focusTaskId as number)}>
          <span><Flag size={17} /></span><div><small>今日唯一重点</small><strong>{dailyRhythm.focusTaskTitle}</strong></div><ChevronRight size={16} />
        </button>
      )}

      <div className="today-layout">
        <div className="today-main">
          <section className="metric-strip today-metrics" aria-label="今日概览">
            <div><CheckCircle2 size={19} /><span>任务</span><strong>{completed}/{activeScheduled.length}</strong></div>
            <div><Clock3 size={19} /><span>计划时长</span><strong>{Math.floor(plannedMinutes / 60)}h {plannedMinutes % 60}m</strong></div>
            <div><TimerReset size={19} /><span>专注时长</span><strong>{Math.floor(focusMinutes / 60)}h {focusMinutes % 60}m</strong></div>
            <div><TrendingUp size={19} /><span>今日节奏</span><strong>{rhythmLabel}</strong></div>
          </section>

          <section className="content-section timeline-section">
            <div className="section-title-row">
              <div><h2>今日时间轴</h2><span>{scheduled.length} 项安排</span></div>
              <button className="text-button" onClick={() => onNavigate('calendar')}>调整日程 <ChevronRight size={15} /></button>
            </div>
            <div className="timeline">
              {scheduled.map((task) => (
                <article className={`timeline-item ${task.completed ? 'is-complete' : ''} ${task.skipped ? 'is-skipped' : ''}`} key={task.id}>
                  <div className="timeline-time"><strong>{task.start}</strong><span>{task.end}</span></div>
                  <span className="timeline-dot" style={{ borderColor: task.color, backgroundColor: task.completed ? task.color : '#fff' }} />
                  <div className="timeline-task" style={{ '--task-color': task.color } as React.CSSProperties}>
                    <TaskCheck task={task} onToggle={toggleTask} />
                    <button type="button" className="task-copy task-open-button" onClick={() => onOpenTask(task.id)}>
                      <strong>{task.title}{task.skipped ? ' · 已跳过' : ''}</strong>
                      <span>{task.project} · {task.duration} 分钟{task.isFocus ? ' · 专注' : ''}</span>
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
                      <button type="button" className={`calendar-event ${occurrence.projected ? 'is-projected' : ''} ${occurrence.task.skipped ? 'is-skipped' : ''}`} onClick={() => onOpenTask(occurrence.task.id)} style={{ '--event-color': occurrence.task.color } as React.CSSProperties} key={occurrence.key}><strong>{occurrence.task.title}{occurrence.task.skipped ? ' · 已跳过' : ''}</strong><span>{occurrence.time}–{occurrence.endTime ?? '待定'}</span></button>
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

function ReviewPage({ summary, tasks, onAiPlan }: { summary: ReviewSummary; tasks: Task[]; onAiPlan: () => void }) {
  const weekDates = Array.from({ length: 7 }, (_, index) => currentWeekDateIso(index))
  const weekTasks = tasks.filter((task) => !task.skipped && weekDates.includes(taskReviewDate(task) ?? ''))
  const fallbackCompleted = weekTasks.filter((task) => task.completed)
  const fallbackDaily = weekDates.map((date) => {
    const dayTasks = tasks.filter((task) => !task.skipped && taskReviewDate(task) === date)
    const completed = dayTasks.filter((task) => task.completed).length
    return {
      date,
      total: dayTasks.length,
      completed,
      completionRate: dayTasks.length > 0 ? Math.round((completed / dayTasks.length) * 100) : 0,
      plannedMinutes: dayTasks.reduce((sum, task) => sum + task.duration, 0),
      focusMinutes: 0,
      wakeTime: null,
      hadBreakfast: null,
      morningEnergy: null,
      eveningEnergy: null,
      focusSelected: false,
      focusCompleted: false,
      closed: false,
    }
  })
  const hasServerReview = summary.weekStart !== ''
  const daily = summary.days.length > 0 ? summary.days : fallbackDaily
  const completedCount = hasServerReview ? summary.completed : fallbackCompleted.length
  const totalCount = hasServerReview ? summary.total : weekTasks.length
  const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const completedMinutes = hasServerReview ? summary.completedMinutes : fallbackCompleted.reduce((sum, task) => sum + task.duration, 0)
  const completedThisWeek = tasks.filter((task) => task.completed && !task.skipped && weekDates.includes(task.completedAt?.slice(0, 10) ?? taskReviewDate(task) ?? ''))
  const fallbackCalibrationTasks = completedThisWeek.filter((task) => task.actualMinutes !== null && task.actualMinutes !== undefined)
  const fallbackCalibrationEstimated = fallbackCalibrationTasks.reduce((sum, task) => sum + task.duration, 0)
  const fallbackCalibrationActual = fallbackCalibrationTasks.reduce((sum, task) => sum + (task.actualMinutes ?? 0), 0)
  const fallbackCalibrationError = fallbackCalibrationTasks.reduce((sum, task) => sum + Math.abs((task.actualMinutes ?? task.duration) - task.duration), 0)
  const calibrationSamples = hasServerReview ? summary.calibrationSamples : fallbackCalibrationTasks.length
  const calibrationEstimatedMinutes = hasServerReview ? summary.calibrationEstimatedMinutes : fallbackCalibrationEstimated
  const calibrationActualMinutes = hasServerReview ? summary.calibrationActualMinutes : fallbackCalibrationActual
  const estimateAccuracy = hasServerReview
    ? summary.estimateAccuracy
    : calibrationEstimatedMinutes > 0
      ? Math.max(0, Math.round(100 - (fallbackCalibrationError / calibrationEstimatedMinutes) * 100))
      : null
  const categoryMinutes = completedThisWeek.reduce<Record<string, { label: string; color: string; minutes: number }>>((result, task) => {
    const key = task.category || '未分类'
    const current = result[key] ?? { label: key, color: task.color, minutes: 0 }
    current.minutes += task.actualMinutes ?? task.duration
    result[key] = current
    return result
  }, {})
  const totalCategoryMinutes = completedThisWeek.reduce((sum, task) => sum + (task.actualMinutes ?? task.duration), 0)
  const categoryInvestment = Object.values(categoryMinutes)
    .sort((left, right) => right.minutes - left.minutes)
    .map((category) => ({ ...category, value: totalCategoryMinutes > 0 ? Math.round((category.minutes / totalCategoryMinutes) * 100) : 0 }))
  const hasDailyData = daily.some((day) => day.total > 0 || day.wakeTime || day.morningEnergy !== null || day.focusMinutes > 0)
  const strongestCategory = categoryInvestment[0]
  const hours = Math.floor(completedMinutes / 60)
  const minutes = completedMinutes % 60
  const focusHours = Math.floor(summary.focusActualMinutes / 60)
  const focusMinutes = summary.focusActualMinutes % 60
  const movedCount = summary.carryovers.tomorrow + summary.carryovers.later + summary.carryovers.drop
  const calibrationDifference = calibrationActualMinutes - calibrationEstimatedMinutes
  const mostCommonFailure = summary.failureReasons[0]
  const mostCommonRescue = summary.rescueReasons[0]
  const rescueContinueRate = summary.rescueStarts > 0 ? Math.round((summary.rescueContinued / summary.rescueStarts) * 100) : 0
  const maxFailureCount = Math.max(1, ...summary.failureReasons.map((reason) => reason.count))
  const energyChange = summary.averageMorningEnergy !== null && summary.averageEveningEnergy !== null
    ? Math.round((summary.averageEveningEnergy - summary.averageMorningEnergy) * 10) / 10
    : null
  const weekLabel = summary.weekStart ? `${summary.weekStart.slice(5).replace('-', '.')}–${summary.weekEnd.slice(5).replace('-', '.')}` : '本周'

  return (
    <div className="page-content review-page-v2">
      <section className="page-heading">
        <div><p className="eyebrow">REVIEW</p><h1>回顾</h1><p>看见真实的节奏，再决定下一步。</p></div>
        <div className="review-heading-actions"><span className="date-button review-period">{weekLabel}</span><button type="button" className="primary-button" onClick={onAiPlan}><Sparkles size={16} />准备下周</button></div>
      </section>
      <section className="review-overview">
        <div className="review-score"><span>本周完成率</span><strong>{completionRate}%</strong><p>完成 {completedCount}/{totalCount} 项</p></div>
        <div><TimerReset size={20} /><span>真实专注</span><strong>{focusHours}h {focusMinutes}m</strong><small>计划专注 {Math.floor(summary.focusPlannedMinutes / 60)}h {summary.focusPlannedMinutes % 60}m</small></div>
        <div><Flag size={20} /><span>每日重点</span><strong>{summary.dailyFocusRate}%</strong><small>完成 {summary.dailyFocusCompleted}/{summary.dailyFocusSelected} 天</small></div>
        <div><CornerDownRight size={20} /><span>任务迁移</span><strong>{movedCount}</strong><small>明天、以后或放弃</small></div>
      </section>
      <div className="review-grid">
        <section className="content-section chart-section">
          <div className="section-title-row"><div><h2>每日完成情况</h2><span>任务完成率</span></div><TrendingUp size={18} /></div>
          {hasDailyData ? <div className="bar-chart">
            {daily.map((day, index) => <div key={day.date}><span className={day.date === berlinIsoDate() ? 'today' : ''} style={{ height: `${Math.max(5, day.completionRate)}%` }}><i>{day.total > 0 ? `${day.completionRate}%` : '–'}</i></span><small>周{weekDays[index]}</small></div>)}
          </div> : <div className="review-empty"><BarChart3 size={20} /><strong>本周还没有任务记录</strong><span>完成任务后，这里会生成真实趋势。</span></div>}
        </section>
        <section className="content-section category-section">
          <div className="section-title-row"><div><h2>时间投入</h2><span>按生活领域</span></div></div>
          {categoryInvestment.map((category) => <div className="category-row" key={category.label}><span className="category-dot" style={{ backgroundColor: category.color }} /><strong>{category.label}</strong><ProgressBar value={category.value} color={category.color} /><span>{Math.floor(category.minutes / 60)}h {category.minutes % 60}m</span></div>)}
          {categoryInvestment.length === 0 && <div className="review-empty compact"><Clock3 size={20} /><strong>暂无时间投入</strong><span>完成任务并确认耗时后，这里会按生活领域汇总。</span></div>}
        </section>
      </div>
      <section className="content-section rhythm-review-section">
        <div className="section-title-row"><div><h2>每日生活节奏</h2><span>晨间、精力和收尾记录</span></div><span>{summary.morningCheckins} 次启动 · {summary.eveningCheckins} 次收尾</span></div>
        <div className="rhythm-review-table">
          <div className="rhythm-review-head"><span>日期</span><span>起床</span><span>早餐</span><span>晨间精力</span><span>真实专注</span><span>今日重点</span><span>收尾</span></div>
          {daily.map((day, index) => <div className={day.date === berlinIsoDate() ? 'today' : ''} key={day.date}>
            <strong>周{weekDays[index]}<small>{day.date.slice(5).replace('-', '.')}</small></strong>
            <span>{day.wakeTime ?? '–'}</span>
            <span>{day.hadBreakfast === null ? '–' : day.hadBreakfast ? '已吃' : '未吃'}</span>
            <span>{day.morningEnergy === null ? '–' : `${day.morningEnergy}/5`}{day.eveningEnergy !== null && <small>晚 {day.eveningEnergy}/5</small>}</span>
            <span>{day.focusMinutes > 0 ? `${Math.floor(day.focusMinutes / 60)}h ${day.focusMinutes % 60}m` : '–'}</span>
            <span className={day.focusCompleted ? 'positive' : ''}>{day.focusSelected ? day.focusCompleted ? '已完成' : '未完成' : '–'}</span>
            <span className={day.closed ? 'positive' : ''}>{day.closed ? '已收尾' : '–'}</span>
          </div>)}
        </div>
      </section>
      <section className="review-carryover-band" aria-label="任务迁移明细">
        <div><CornerDownRight size={18} /><span>推到明天</span><strong>{summary.carryovers.tomorrow}</strong></div>
        <div><Archive size={18} /><span>留到以后</span><strong>{summary.carryovers.later}</strong></div>
        <div><Trash2 size={18} /><span>跳过或放弃</span><strong>{summary.carryovers.drop}</strong></div>
      </section>
      {summary.rescueStarts > 0 && <section className="content-section rescue-review-section">
        <div className="section-title-row"><div><h2>启动救援</h2><span>不是逼自己做完，只看有没有重新动起来</span></div><span>{summary.rescueStarts} 次使用</span></div>
        <div className="rescue-review-metrics">
          <div><Sparkles size={18} /><span>重新开始</span><strong>{summary.rescueContinued}</strong><small>{rescueContinueRate}% 选择继续原任务</small></div>
          <div><Clock3 size={18} /><span>最小动作</span><strong>{summary.rescueMinutes}m</strong><small>救援阶段真实投入</small></div>
          <div><BatteryMedium size={18} /><span>最常卡点</span><strong>{mostCommonRescue ? rescueReasonLabels[mostCommonRescue.reason] : '暂无'}</strong><small>{mostCommonRescue ? `${mostCommonRescue.count} 次记录` : '继续使用后会形成趋势'}</small></div>
        </div>
      </section>}
      <section className="content-section plan-calibration-section">
        <div className="section-title-row"><div><h2>计划校准</h2><span>预计与实际，以及阻碍发生在哪里</span></div><span>{calibrationSamples} 项有效记录</span></div>
        {calibrationSamples > 0 || summary.failureReasons.length > 0 ? <div className="calibration-review-layout">
          <div className="calibration-metrics">
            <div><Target size={18} /><span>估时准确率</span><strong>{estimateAccuracy ?? 0}%</strong></div>
            <div><Clock3 size={18} /><span>预计投入</span><strong>{Math.floor(calibrationEstimatedMinutes / 60)}h {calibrationEstimatedMinutes % 60}m</strong></div>
            <div><TimerReset size={18} /><span>实际投入</span><strong>{Math.floor(calibrationActualMinutes / 60)}h {calibrationActualMinutes % 60}m</strong><small>{calibrationDifference === 0 ? '与预计一致' : calibrationDifference > 0 ? `多 ${calibrationDifference} 分钟` : `少 ${Math.abs(calibrationDifference)} 分钟`}</small></div>
          </div>
          <div className="failure-reason-review">
            <div className="task-detail-heading"><h3>未完成原因</h3><span>{summary.failureReasons.reduce((sum, reason) => sum + reason.count, 0)} 次记录</span></div>
            {summary.failureReasons.map((reason) => <div key={reason.reason}><strong>{failureReasonLabels[reason.reason]}</strong><ProgressBar value={Math.round((reason.count / maxFailureCount) * 100)} color="#b96552" /><span>{reason.count}</span></div>)}
            {summary.failureReasons.length === 0 && <p className="empty-copy">本周还没有未完成原因记录。</p>}
          </div>
        </div> : <div className="review-empty compact"><TrendingUp size={20} /><strong>从下一次完成开始校准</strong><span>确认实际耗时或在晚间选择未完成原因后，这里会形成趋势。</span></div>}
      </section>
      <section className="content-section reflection-section">
        <div className="section-title-row"><div><h2>本周观察</h2><span>根据现有记录自动整理</span></div></div>
        <div className="reflection-grid">
          <div><strong>本周投入</strong><p>{calibrationSamples > 0 ? `有 ${calibrationSamples} 项记录了实际耗时，合计 ${Math.floor(calibrationActualMinutes / 60)} 小时 ${calibrationActualMinutes % 60} 分钟，估时准确率 ${estimateAccuracy}%。` : totalCount > 0 ? `完成 ${completedCount} 项，预计投入 ${hours} 小时 ${minutes} 分钟；其中真实专注 ${focusHours} 小时 ${focusMinutes} 分钟。` : '还没有可供回顾的任务记录。'}</p></div>
          <div><strong>生活节奏</strong><p>{summary.averageWakeTime ? `平均 ${summary.averageWakeTime} 起床，${summary.breakfastDays} 天记录了早餐${energyChange === null ? '。' : `；从早到晚精力变化 ${energyChange > 0 ? '+' : ''}${energyChange}。`}` : '完成晨间启动后，这里会显示起床与精力趋势。'}</p></div>
          <div><strong>下周线索</strong><p>{mostCommonFailure ? `最常出现的阻力是“${failureReasonLabels[mostCommonFailure.reason]}”，下周安排时会优先处理这个问题。` : movedCount > 0 ? `本周有 ${movedCount} 次任务迁移；准备下周时应主动减少负荷。` : strongestCategory ? `${strongestCategory.label}投入最多，可以继续保留这个节奏。` : '继续记录几天后，这里会给出下周线索。'}</p></div>
        </div>
      </section>
    </div>
  )
}

function SettingsPage({ settings: initialSettings, browserPush, activeSection, dataCounts, planImports, backups, onSectionChange, onSave, onEnablePush, onDisablePush, onTestPush, onTestMail, onChangePassword, onExportData, onClearTasksAndHabits, onCreateBackup, onPreviewBackup, onPreviewStoredBackup, onRestoreBackup, onRestoreStoredBackup, onDownloadStoredBackup, onImportPlan, onDeletePlanImport, onLogout }: {
  settings: UserSettings
  browserPush: BrowserPushState
  activeSection: SettingsSectionKey
  dataCounts: { tasks: number; projects: number; habits: number; categories: number }
  planImports: PlanImportBatch[]
  backups: BackupRecord[]
  onSectionChange: (section: SettingsSectionKey) => void
  onSave: (settings: UserSettings) => Promise<void>
  onEnablePush: () => Promise<void>
  onDisablePush: () => Promise<void>
  onTestPush: () => Promise<void>
  onTestMail: () => Promise<void>
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>
  onExportData: () => Promise<void>
  onClearTasksAndHabits: () => Promise<void>
  onCreateBackup: () => Promise<void>
  onPreviewBackup: (backup: Record<string, unknown>) => Promise<BackupPreview>
  onPreviewStoredBackup: (id: number) => Promise<BackupPreview>
  onRestoreBackup: (backup: Record<string, unknown>, password: string) => Promise<void>
  onRestoreStoredBackup: (id: number, password: string) => Promise<void>
  onDownloadStoredBackup: (backup: BackupRecord) => Promise<void>
  onImportPlan: (plan: PlanImportDocument) => Promise<PlanImportCounts>
  onDeletePlanImport: (id: number) => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [testingMail, setTestingMail] = useState(false)
  const [pushBusy, setPushBusy] = useState<'enable' | 'disable' | 'test' | null>(null)
  const [pushError, setPushError] = useState('')
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
  const [promptCopied, setPromptCopied] = useState(false)
  const [deletingImportId, setDeletingImportId] = useState<number | null>(null)
  const [backupData, setBackupData] = useState<Record<string, unknown> | null>(null)
  const [backupPreview, setBackupPreview] = useState<BackupPreview | null>(null)
  const [restoreStoredId, setRestoreStoredId] = useState<number | null>(null)
  const [restorePassword, setRestorePassword] = useState('')
  const [backupError, setBackupError] = useState('')
  const [backupBusy, setBackupBusy] = useState(false)
  const [clearingData, setClearingData] = useState(false)
  const [clearDataError, setClearDataError] = useState('')

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

  async function runPushAction(action: 'enable' | 'disable' | 'test') {
    setPushBusy(action)
    setPushError('')
    try {
      if (action === 'enable') await onEnablePush()
      else if (action === 'disable') await onDisablePush()
      else await onTestPush()
    } catch (error) {
      setPushError(error instanceof Error ? error.message : '浏览器推送操作失败。')
    } finally {
      setPushBusy(null)
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

  async function clearTasksAndHabits() {
    if (!window.confirm(`将永久删除 ${dataCounts.tasks} 个任务和 ${dataCounts.habits} 个习惯。系统会先自动创建完整服务器备份，项目、分类和设置会保留。确认继续？`)) return
    setClearingData(true)
    setClearDataError('')
    try {
      await onClearTasksAndHabits()
    } catch (error) {
      setClearDataError(error instanceof Error ? error.message : '清空失败。')
    } finally {
      setClearingData(false)
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
        ? '/public/examples/sakura-daily-routine-v3.json'
        : '/examples/sakura-daily-routine-v3.json'
      const response = await fetch(examplePath, { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error('无法读取推荐日程。')
      const text = await response.text()
      setImportText(text)
      previewImport(text)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法读取推荐日程。')
    }
  }

  async function copyPlannerPrompt() {
    setImportError('')
    try {
      await copyText(buildPlanImportPrompt(settings, berlinIsoDate()))
      setPromptCopied(true)
      window.setTimeout(() => setPromptCopied(false), 2200)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '提示词复制失败。')
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

  async function loadBackupFile(file: File) {
    setBackupError('')
    if (file.size > 20 * 1024 * 1024) {
      setBackupError('备份文件不能超过 20 MB。')
      return
    }
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>
      setBackupData(parsed)
      setBackupPreview(await onPreviewBackup(parsed))
      setRestoreStoredId(null)
    } catch (error) {
      setBackupData(null)
      setBackupPreview(null)
      setBackupError(error instanceof Error ? error.message : '无法读取备份文件。')
    }
  }

  async function restoreSelectedBackup() {
    if (!restorePassword || (!backupData && restoreStoredId === null)) return
    if (!window.confirm('恢复会完整替换当前看板数据。账户、密码和服务器密钥会保留，确认继续？')) return
    setBackupBusy(true)
    setBackupError('')
    try {
      if (backupData) await onRestoreBackup(backupData, restorePassword)
      else await onRestoreStoredBackup(restoreStoredId as number, restorePassword)
      setBackupData(null)
      setBackupPreview(null)
      setRestoreStoredId(null)
      setRestorePassword('')
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : '恢复失败。')
    } finally {
      setBackupBusy(false)
    }
  }

  async function selectStoredBackup(id: number) {
    setBackupBusy(true)
    setBackupError('')
    try {
      setBackupData(null)
      setRestoreStoredId(id)
      setBackupPreview(await onPreviewStoredBackup(id))
    } catch (error) {
      setRestoreStoredId(null)
      setBackupPreview(null)
      setBackupError(error instanceof Error ? error.message : '无法读取服务器备份。')
    } finally {
      setBackupBusy(false)
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
              <div className="settings-title"><div><Smartphone size={19} /><div><h2>iPhone 即时提醒</h2><p>即使看板没有打开，也能在锁屏收到通知</p></div></div></div>
              <div className={`push-status-card ${browserPush.subscribed ? 'ready' : ''}`}>
                <span className="push-status-icon"><Bell size={21} /></span>
                <div>
                  <strong>{browserPush.subscribed ? '当前 iPhone 已连接' : !browserPush.supported ? '当前浏览器不支持推送' : browserPush.ios && !browserPush.standalone ? '先添加到主屏幕' : browserPush.permission === 'denied' ? '通知权限已关闭' : browserPush.configured ? '等待开启通知' : '服务器推送尚未就绪'}</strong>
                  <span>{browserPush.subscribed ? `共有 ${Math.max(1, browserPush.subscriptionCount)} 台设备接收提醒` : browserPush.ios && !browserPush.standalone ? 'Safari 中不能直接授权，需要从桌面图标打开人生看板。' : browserPush.permission === 'denied' ? '请在 iPhone 设置的通知列表中重新允许人生看板。' : '开启后可以发送测试通知，再关闭邮件提醒。'}</span>
                </div>
                <em>{browserPush.subscribed ? '已开启' : '未开启'}</em>
              </div>
              {browserPush.ios && !browserPush.standalone && (
                <div className="ios-install-steps">
                  <strong>在 iPhone 上安装</strong>
                  <span><b>1</b> 使用 Safari 打开本站，点击底部分享按钮</span>
                  <span><b>2</b> 选择“添加到主屏幕”，保持“作为网页 App 打开”</span>
                  <span><b>3</b> 从桌面图标重新进入，再点击“开启通知”</span>
                </div>
              )}
              <div className="push-actions">
                {!browserPush.subscribed ? (
                  <button type="button" className="primary-button" onClick={() => void runPushAction('enable')} disabled={pushBusy !== null || !browserPush.supported || !browserPush.configured || (browserPush.ios && !browserPush.standalone) || browserPush.permission === 'denied'}><Bell size={16} />{pushBusy === 'enable' ? '正在连接…' : '开启通知'}</button>
                ) : (
                  <>
                    <button type="button" className="primary-button" onClick={() => void runPushAction('test')} disabled={pushBusy !== null}><Bell size={16} />{pushBusy === 'test' ? '发送中…' : '发送测试通知'}</button>
                    <button type="button" className="outline-button" onClick={() => void runPushAction('disable')} disabled={pushBusy !== null}>{pushBusy === 'disable' ? '正在关闭…' : '关闭此设备'}</button>
                  </>
                )}
              </div>
              {pushError && <p className="form-error">{pushError}</p>}
              <div className="setting-row"><div><strong>任务开始前推送</strong><span>按照每项任务的提前提醒时间发送</span></div><Toggle checked={settings.pushTaskReminders} onChange={() => setSettings({ ...settings, pushTaskReminders: !settings.pushTaskReminders })} /></div>
              <div className="setting-row"><div><strong>每日收尾推送</strong><span>每天 {settings.dailySummaryTime.slice(0, 5)} 提醒回顾今天</span></div><Toggle checked={settings.pushDailySummary} onChange={() => setSettings({ ...settings, pushDailySummary: !settings.pushDailySummary })} /></div>
              <div className="setting-row"><div><strong>逾期任务推送</strong><span>每天上午集中提醒一次</span></div><Toggle checked={settings.pushOverdueReminder} onChange={() => setSettings({ ...settings, pushOverdueReminder: !settings.pushOverdueReminder })} /></div>
              <div className="settings-divider" />
              <div className="settings-title"><div><Mail size={19} /><div><h2>邮件提醒</h2><p>手机测试成功后，可以关闭这里减少邮件打扰</p></div></div></div>
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
                <label><span>AI 整理开始</span><input type="time" value={settings.planningStartTime} onChange={(event) => setSettings({ ...settings, planningStartTime: event.target.value })} /></label>
                <label><span>AI 整理结束</span><input type="time" value={settings.planningEndTime} onChange={(event) => setSettings({ ...settings, planningEndTime: event.target.value })} /></label>
                <div className="time-pair full"><label><span>午餐开始</span><input type="time" value={settings.lunchStartTime} onChange={(event) => setSettings({ ...settings, lunchStartTime: event.target.value })} /></label><label><span>午餐结束</span><input type="time" value={settings.lunchEndTime} onChange={(event) => setSettings({ ...settings, lunchEndTime: event.target.value })} /></label></div>
                <div className="time-pair full"><label><span>晚餐开始</span><input type="time" value={settings.dinnerStartTime} onChange={(event) => setSettings({ ...settings, dinnerStartTime: event.target.value })} /></label><label><span>晚餐结束</span><input type="time" value={settings.dinnerEndTime} onChange={(event) => setSettings({ ...settings, dinnerEndTime: event.target.value })} /></label></div>
                <label><span>任务间缓冲（分钟）</span><input type="number" min="0" max="120" step="5" value={settings.planningBufferMinutes} onChange={(event) => setSettings({ ...settings, planningBufferMinutes: Number(event.target.value) })} /></label>
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
              <div className="plan-import-actions">
                <button type="button" className="outline-button" onClick={exportData} disabled={exporting}><Download size={16} /> {exporting ? '导出中…' : '导出 JSON 备份'}</button>
                <button type="button" className="outline-button" onClick={() => void onCreateBackup()}><Archive size={16} /> 在服务器创建备份</button>
              </div>
              <div className="settings-divider" />
              <div className="settings-title"><div><TimerReset size={19} /><div><h2>恢复完整备份</h2><p>先检查内容，再完整替换当前看板</p></div></div></div>
              <label className="outline-button plan-file-button"><Upload size={16} /> 选择备份文件<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadBackupFile(file); event.currentTarget.value = '' }} /></label>
              {(backupPreview || restoreStoredId !== null) && (
                <div className="backup-restore-panel">
                  {backupPreview && <div><strong>备份版本 {backupPreview.schemaVersion}</strong><span>{taskMoment(backupPreview.exportedAt)} · {backupPreview.counts.tasks} 任务 · {backupPreview.counts.projects} 项目 · {backupPreview.counts.habits} 习惯</span></div>}
                  {restoreStoredId !== null && !backupPreview && <div><strong>恢复服务器备份</strong><span>{backups.find((backup) => backup.id === restoreStoredId)?.fileName}</span></div>}
                  <label><span>当前登录密码</span><input type="password" autoComplete="current-password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} /></label>
                  <button type="button" className="danger-button" disabled={!restorePassword || backupBusy} onClick={() => void restoreSelectedBackup()}>{backupBusy ? '恢复中…' : '确认完整恢复'}</button>
                </div>
              )}
              {backupError && <p className="form-error">{backupError}</p>}
              {backups.length > 0 && (
                <div className="backup-history">
                  <h3>服务器备份</h3>
                  {backups.map((backup) => (
                    <div className="plan-import-history-row" key={backup.id}>
                      <div><strong>{{ manual: '手动', daily: '每日', weekly: '每周', pre_restore: '操作前' }[backup.kind]}备份</strong><span>{taskMoment(backup.createdAt)} · {(backup.sizeBytes / 1024).toFixed(1)} KB</span></div>
                      <button type="button" className="icon-button" title="下载" aria-label="下载备份" onClick={() => void onDownloadStoredBackup(backup)}><Download size={16} /></button>
                      <button type="button" className="outline-button" disabled={backupBusy} onClick={() => void selectStoredBackup(backup.id)}>恢复</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="settings-divider" />
              <div className="settings-title"><div><Upload size={19} /><div><h2>计划导入</h2><p>追加项目、习惯和重复任务</p></div></div></div>
              <div className="plan-prompt-card">
                <div><Sparkles size={19} /><span><strong>让 ChatGPT 生成可导入计划</strong><small>提示词已包含当前时区、用餐时段、缓冲和完整 JSON 规则；复制后在末尾填写你的计划需求。</small></span></div>
                <button type="button" className="outline-button" onClick={() => void copyPlannerPrompt()}>{promptCopied ? <Check size={15} /> : <Copy size={15} />}{promptCopied ? '已复制' : '复制提示词'}</button>
              </div>
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
              <div className="settings-divider" />
              <div className="data-danger-zone">
                <div><Trash2 size={19} /><span><strong>清空任务和习惯</strong><small>操作前会自动创建完整服务器备份；项目、分类、账户和设置都会保留。</small></span></div>
                <button type="button" className="danger-button" onClick={() => void clearTasksAndHabits()} disabled={clearingData || (dataCounts.tasks === 0 && dataCounts.habits === 0)}><Trash2 size={15} />{clearingData ? '清空中…' : '全部清空'}</button>
              </div>
              {clearDataError && <p className="form-error">{clearDataError}</p>}
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
  const [backups, setBackups] = useState<BackupRecord[]>([])
  const [settings, setSettings] = useState(defaultSettings)
  const [browserPush, setBrowserPush] = useState<BrowserPushState>(initialBrowserPush)
  const [review, setReview] = useState(defaultReview)
  const [dailyRhythm, setDailyRhythm] = useState<DailyRhythm>(() => emptyDailyRhythm())
  const [dailyFlow, setDailyFlow] = useState<'morning' | 'evening' | null>(null)
  const [completionTaskId, setCompletionTaskId] = useState<number | null>(null)
  const [rescueTaskId, setRescueTaskId] = useState<number | null>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [quickEntry, setQuickEntry] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [aiPlannerOpen, setAiPlannerOpen] = useState(false)
  const [aiPlanScope, setAiPlanScope] = useState<AiPlanScope>('today')
  const [rebalanceSetupOpen, setRebalanceSetupOpen] = useState(false)
  const [rebalanceInput, setRebalanceInput] = useState<RebalanceInput | null>(null)
  const [aiPlan, setAiPlan] = useState<AiPlan | null>(null)
  const [aiPlanLoading, setAiPlanLoading] = useState(false)
  const [aiPlanApplying, setAiPlanApplying] = useState(false)
  const [aiPlanError, setAiPlanError] = useState('')
  const [idlePermission, setIdlePermission] = useState<IdlePermissionState>(() => window.IdleDetector ? 'unknown' : 'unsupported')
  const [idleWarning, setIdleWarning] = useState<FocusIdleWarning | null>(null)
  const [idleClock, setIdleClock] = useState(Date.now())
  const idleWarningRef = useRef<FocusIdleWarning | null>(null)
  const idlePauseInFlight = useRef(false)
  const idleNotification = useRef<Notification | null>(null)
  const baseDocumentTitle = useRef(document.title)
  const dailyPrompted = useRef('')

  const inboxCount = useMemo(() => tasks.filter((task) => !task.completed && task.unscheduled).length, [tasks])
  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId), [selectedTaskId, tasks])
  const completionTask = useMemo(() => tasks.find((task) => task.id === completionTaskId), [completionTaskId, tasks])
  const rescueTask = useMemo(() => tasks.find((task) => task.id === rescueTaskId), [rescueTaskId, tasks])
  const runningFocusTask = useMemo(() => tasks.find((task) => task.focusSession?.status === 'running') ?? null, [tasks])
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
    if (loggedIn !== true) return
    void refreshBrowserPush()
  }, [demoMode, loggedIn])

  useEffect(() => {
    if (loggedIn !== true || tasks.length === 0) return
    const url = new URL(window.location.href)
    const taskId = Number(url.searchParams.get('task'))
    if (!Number.isInteger(taskId) || !tasks.some((task) => task.id === taskId)) return
    const minutes = berlinClockMinutes()
    const prompt = dailyRhythm.morningStatus === 'pending' && minutes < 12 * 60
      ? 'morning'
      : !dailyRhythm.closedAt && minutes >= 22 * 60 + 30
        ? 'evening'
        : null
    if (prompt !== null) dailyPrompted.current = `${dailyRhythm.date}-${prompt}`
    setDailyFlow(null)
    setSelectedTaskId(taskId)
    url.searchParams.delete('task')
    url.searchParams.delete('from')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }, [dailyRhythm.closedAt, dailyRhythm.date, dailyRhythm.morningStatus, loggedIn, tasks])

  useEffect(() => {
    if (loggedIn !== true) return
    const interval = window.setInterval(() => {
      if (dailyRhythm.date === berlinIsoDate()) return
      dailyPrompted.current = ''
      if (demoMode) {
        setDailyRhythm(emptyDailyRhythm())
        return
      }
      void api.bootstrap().then(applyBootstrap).catch(() => undefined)
    }, 60_000)
    return () => window.clearInterval(interval)
  }, [dailyRhythm.date, demoMode, loggedIn])

  useEffect(() => {
    if (loggedIn !== true || page !== 'today' || dailyFlow !== null || dailyRhythm.date !== berlinIsoDate()) return
    const minutes = berlinClockMinutes()
    const prompt = dailyRhythm.morningStatus === 'pending' && minutes < 12 * 60
      ? 'morning'
      : !dailyRhythm.closedAt && minutes >= 22 * 60 + 30
        ? 'evening'
        : null
    if (prompt === null || dailyPrompted.current === `${dailyRhythm.date}-${prompt}`) return
    dailyPrompted.current = `${dailyRhythm.date}-${prompt}`
    setDailyFlow(prompt)
  }, [dailyFlow, dailyRhythm, loggedIn, page])

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
    setBackups(data.backups ?? [])
    setDailyRhythm(data.dailyRhythm ?? emptyDailyRhythm())
    setSettings(data.settings)
    setReview(data.review)
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }

  async function refreshBrowserPush() {
    const supported = pushSupported()
    const base = {
      supported,
      ios: isIosDevice(),
      standalone: isStandaloneApp(),
      permission: supported ? Notification.permission : 'unsupported' as const,
    }
    if (!supported) {
      setBrowserPush({ ...initialBrowserPush, ...base, configured: false, subscribed: false, subscriptionCount: 0 })
      return
    }
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
      const subscription = await registration.pushManager.getSubscription()
      const config = demoMode
        ? { configured: false, publicKey: '', subscriptionCount: 0 }
        : await api.pushConfig()
      setBrowserPush({ ...base, configured: config.configured, subscribed: subscription !== null, subscriptionCount: config.subscriptionCount })
    } catch {
      setBrowserPush({ ...initialBrowserPush, ...base, configured: false, subscribed: false, subscriptionCount: 0 })
    }
  }

  async function enableBrowserPush() {
    if (!pushSupported()) throw new Error('当前浏览器不支持后台推送。')
    if (isIosDevice() && !isStandaloneApp()) throw new Error('请先把人生看板添加到主屏幕，再从桌面图标打开。')
    if (demoMode) throw new Error('本地演示模式不会创建真实推送订阅。')
    const config = await api.pushConfig()
    if (!config.configured || !config.publicKey) throw new Error('服务器还没有生成推送密钥，请重新运行部署脚本。')
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      await refreshBrowserPush()
      throw new Error('通知权限没有开启。可以在 iPhone 设置 → 通知中重新允许。')
    }
    const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
    let subscription = await registration.pushManager.getSubscription()
    if (subscription === null) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: pushApplicationKey(config.publicKey),
      })
    }
    try {
      const encodings = (PushManager as unknown as { supportedContentEncodings?: string[] }).supportedContentEncodings
      await api.subscribePush(subscription.toJSON(), encodings?.[0] ?? 'aes128gcm', isIosDevice() ? 'iPhone · 主屏幕' : '浏览器设备')
    } catch (error) {
      await subscription.unsubscribe()
      throw error
    }
    await refreshBrowserPush()
    showToast('iPhone 即时提醒已开启')
  }

  async function disableBrowserPush() {
    if (!pushSupported()) return
    const registration = await navigator.serviceWorker.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
      if (!demoMode) await api.unsubscribePush(subscription.endpoint)
      await subscription.unsubscribe()
    }
    await refreshBrowserPush()
    showToast('已关闭这台设备的推送')
  }

  async function testBrowserPush() {
    if (!pushSupported()) throw new Error('当前浏览器不支持后台推送。')
    const registration = await navigator.serviceWorker.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()
    if (!subscription) throw new Error('当前设备还没有开启通知。')
    if (demoMode) throw new Error('本地演示模式不会发送真实通知。')
    await api.testPush(subscription.endpoint)
    showToast('测试通知已发出')
  }

  function demoAiPlan(scope: AiPlanScope, runtime?: RebalanceInput): AiPlan {
    const today = berlinIsoDate()
    const rebalancing = scope === 'rebalance'
    const source = (rebalancing
      ? tasks.filter((task) => isOpenTask(task) && taskCalendarDate(task) === today && task.scheduleMode !== 'fixed')
      : tasks.filter((task) => !task.completed && task.unscheduled))
      .sort((left, right) => {
        const focusOrder = Number(right.id === dailyRhythm.focusTaskId) - Number(left.id === dailyRhythm.focusTaskId)
        return focusOrder || taskPriorityWeight(left) - taskPriorityWeight(right) || (taskStartMinutes(left) ?? 24 * 60) - (taskStartMinutes(right) ?? 24 * 60)
      })
      .slice(0, 8)
    if (source.length === 0) throw new Error(rebalancing ? '余下今天没有可以重排的任务。' : '收集箱里没有需要安排的任务。')
    const targetStart = scope === 'next_week' ? shiftIsoDate(currentWeekDateIso(0), 7) : today
    const targetDays = scope === 'next_week' ? 7 : 1
    const nowParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Berlin',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date())
    const nowMinutes = Number(nowParts.find((part) => part.type === 'hour')?.value ?? 8) * 60
      + Number(nowParts.find((part) => part.type === 'minute')?.value ?? 0)
    const sourceIds = new Set(source.map((task) => task.id))
    const occupied = tasks.flatMap((task) => {
      const date = task.startAt?.slice(0, 10) ?? (task.start && !task.unscheduled ? today : null)
      const start = task.startAt?.slice(11, 16) ?? task.start
      const end = task.endAt?.slice(11, 16) ?? task.end
      if (task.completed || sourceIds.has(task.id) || !date || !start || !end) return []
      return [{
        date,
        start: Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)),
        end: Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)),
      }]
    })
    for (let dayOffset = 0; dayOffset < targetDays; dayOffset += 1) {
      const date = shiftIsoDate(targetStart, dayOffset)
      for (const [start, end] of [[settings.lunchStartTime, settings.lunchEndTime], [settings.dinnerStartTime, settings.dinnerEndTime]]) {
        occupied.push({
          date,
          start: Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)),
          end: Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)),
        })
      }
    }
    const items: AiPlan['items'] = []
    const skipped: AiPlan['skipped'] = []
    const planningStart = Number(settings.planningStartTime.slice(0, 2)) * 60 + Number(settings.planningStartTime.slice(3, 5))
    const requestedEnd = runtime?.latestEnd ?? settings.planningEndTime
    const planningEnd = Number(requestedEnd.slice(0, 2)) * 60 + Number(requestedEnd.slice(3, 5))
    const lowEnergyBudget = runtime?.mode === 'low_energy' ? [0, 60, 90, 150, 240, 360][runtime.currentEnergy] : Number.POSITIVE_INFINITY
    let scheduledMinutes = 0

    source.forEach((task) => {
      const duration = Math.max(1, task.duration)
      const skipAction = task.recurrenceRule ? 'skip' : 'later'
      if (rebalancing && scheduledMinutes + duration > lowEnergyBudget && task.id !== dailyRhythm.focusTaskId) {
        skipped.push({ taskId: task.id, title: task.title, reason: '低能量保底模式主动减少了今天的负荷。', action: skipAction })
        return
      }
      let slot: { date: string; start: number } | null = null
      for (let dayOffset = 0; dayOffset < targetDays && !slot; dayOffset += 1) {
        const date = shiftIsoDate(targetStart, dayOffset)
        let cursor = scope !== 'next_week' && dayOffset === 0
          ? Math.max(planningStart, Math.ceil((nowMinutes + 15) / 15) * 15)
          : planningStart
        while (cursor + duration <= planningEnd) {
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
        skipped.push({ taskId: task.id, title: task.title, reason: rebalancing ? '在今晚结束前没有足够长的可用时段。' : '未来七天没有足够长的空闲时段。', action: rebalancing ? skipAction : 'keep' })
        return
      }
      occupied.push({ date: slot.date, start: slot.start, end: slot.start + duration + 15 })
      scheduledMinutes += duration
      items.push({
        taskId: task.id,
        title: task.title,
        startAt: localDateTime(slot.date, slot.start),
        endAt: localDateTime(slot.date, slot.start + duration),
        duration,
        priority: task.priority,
        reason: task.dueAt ? '优先靠近截止时间，并保留任务间的缓冲。' : '按照优先级放入可用时段。',
        blocks: [{
          startAt: localDateTime(slot.date, slot.start),
          endAt: localDateTime(slot.date, slot.start + duration),
          duration,
        }],
      })
    })
    if (items.length === 0 && !rebalancing) throw new Error('未来七天没有足够的空闲时间，请先调整现有日程。')
    return {
      id: -1,
      model: 'demo',
      summary: scope === 'next_week' ? `根据本周节奏，为下周 ${items.length} 项灵活任务留出了完整时间。` : rebalancing ? `余下今天保留 ${items.length} 项，放下 ${skipped.length} 项。` : `已为 ${items.length} 项任务留出完整时间，并在任务之间保留缓冲。`,
      adjustments: scope === 'next_week' ? ['把最费脑力的任务放在精力更好的上午。', '午餐和晚餐前后保留缓冲，不用把一周塞满。', '每天只保留一个真正重要的重点。'] : rebalancing ? [runtime?.mode === 'low_energy' ? '今天采用低能量保底，不追赶已经错过的计划。' : '从现在重新开始，只完成现实可行的部分。'] : ['先完成唯一重点，再处理低优先级任务。'],
      items,
      skipped,
      remainingUses: 1,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      scope,
      targetStartDate: targetStart,
      targetEndDate: shiftIsoDate(targetStart, targetDays - 1),
      mode: runtime?.mode ?? null,
      currentEnergy: runtime?.currentEnergy ?? null,
      latestEnd: runtime?.latestEnd ?? null,
    }
  }

  async function generateAiPlan(scope: AiPlanScope = aiPlanScope, runtime: RebalanceInput | null = scope === 'rebalance' ? rebalanceInput : null) {
    setAiPlanScope(scope)
    setAiPlanLoading(true)
    setAiPlan(null)
    setAiPlanError('')
    try {
      setAiPlan(demoMode
        ? demoAiPlan(scope, runtime ?? undefined)
        : scope === 'next_week'
          ? await api.createWeeklyAiPlan()
          : scope === 'rebalance' && runtime
            ? await api.createRebalancePlan(runtime)
            : await api.createAiPlan())
    } catch (error) {
      setAiPlanError(error instanceof Error ? error.message : 'AI 暂时无法生成安排，请稍后再试。')
    } finally {
      setAiPlanLoading(false)
    }
  }

  function openAiPlanner(scope: 'today' | 'next_week' = 'today') {
    setAiPlanScope(scope)
    setAiPlannerOpen(true)
    void generateAiPlan(scope)
  }

  function openRebalanceSetup() {
    setRebalanceSetupOpen(true)
  }

  function startRebalance(input: RebalanceInput) {
    setRebalanceInput(input)
    setRebalanceSetupOpen(false)
    setAiPlanScope('rebalance')
    setAiPlannerOpen(true)
    void generateAiPlan('rebalance', input)
  }

  async function applyAiPlan() {
    if (!aiPlan) return
    setAiPlanApplying(true)
    setAiPlanError('')
    try {
      if (demoMode) {
        const itemMap = new Map(aiPlan.items.map((item) => [item.taskId, item]))
        const skippedMap = new Map(aiPlan.skipped.map((item) => [item.taskId, item]))
        setTasks((current) => current.map((task) => {
          const item = itemMap.get(task.id)
          if (item) return {
            ...task,
            startAt: item.startAt,
            endAt: item.endAt,
            start: item.startAt.slice(11, 16),
            end: item.endAt.slice(11, 16),
            duration: item.duration,
            priority: item.priority,
            unscheduled: false,
            status: 'planned',
          }
          const skipped = skippedMap.get(task.id)
          if (aiPlan.scope !== 'rebalance' || !skipped || skipped.action === 'keep') return task
          return skipped.action === 'skip'
            ? { ...task, status: 'cancelled', skipped: true }
            : { ...task, status: 'inbox', startAt: null, endAt: null, start: undefined, end: undefined, unscheduled: true, scheduleMode: 'flexible', scheduleBlocks: [] }
        }))
      } else {
        applyBootstrap(await api.applyAiPlan(aiPlan.id))
      }
      setAiPlannerOpen(false)
      setAiPlan(null)
      showToast(aiPlan.scope === 'next_week' ? `下周 ${aiPlan.items.length} 项安排已写入` : aiPlan.scope === 'rebalance' ? `余下今天保留 ${aiPlan.items.length} 项，移出 ${aiPlan.skipped.filter((item) => item.action !== 'keep').length} 项` : `已采用 ${aiPlan.items.length} 项 AI 安排`)
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

  async function persistTaskCompletion(task: Task, completed: boolean, actualMinutes?: number) {
    const id = task.id
    const optimisticTask: Task = {
      ...task,
      completed,
      status: completed ? 'completed' : task.startAt ? 'planned' : 'inbox',
      actualMinutes: completed ? actualMinutes ?? task.duration : null,
      completedAt: completed ? new Date().toISOString() : null,
      focusSession: completed && task.focusSession ? { ...task.focusSession, status: 'completed', lastResumedAt: null, endedAt: new Date().toISOString() } : task.focusSession,
    }
    setTasks((current) => current.map((item) => item.id === id ? optimisticTask : item))
    if (completed) showToast('完成一件，今天向前了一点')
    if (!demoMode) {
      try {
        const result = await api.updateTask({ id, completed, ...(completed ? { actualMinutes } : {}) })
        setTasks((current) => {
          const updated = current.map((item) => item.id === id ? result.task : item)
          return result.nextTask && !updated.some((item) => item.id === result.nextTask?.id)
            ? [...updated, result.nextTask]
            : updated
        })
        void api.bootstrap().then((data) => setReview(data.review)).catch(() => undefined)
        if (result.nextTask) showToast('已完成，下一次重复任务也安排好了')
      } catch (error) {
        setTasks((current) => current.map((item) => item.id === id ? task : item))
        throw error
      }
    }
  }

  async function toggleTask(id: number) {
    const task = tasks.find((item) => item.id === id)
    if (!task) return
    if (!task.completed) {
      setCompletionTaskId(id)
      return
    }
    try {
      await persistTaskCompletion(task, false)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '任务状态保存失败')
    }
  }

  async function completeTask(actualMinutes: number) {
    const task = tasks.find((item) => item.id === completionTaskId)
    if (!task) return
    await persistTaskCompletion(task, true, actualMinutes)
    setCompletionTaskId(null)
  }

  async function updateExecutionTask(task: Task, changes: Partial<Task> & { updateScope?: 'single' | 'future' }) {
    if (!demoMode) {
      try {
        const result = await api.updateTask({ id: task.id, ...changes })
        setTasks((current) => {
          const updated = current.map((item) => item.id === task.id ? result.task : item)
          return result.nextTask && !updated.some((item) => item.id === result.nextTask?.id)
            ? [...updated, result.nextTask]
            : updated
        })
        return true
      } catch (error) {
        showToast(error instanceof Error ? error.message : '任务状态保存失败')
        return false
      }
    }

    setTasks((current) => current.map((item) => {
      if (item.id !== task.id) return item
      const startChanged = Object.prototype.hasOwnProperty.call(changes, 'startAt')
      const endChanged = Object.prototype.hasOwnProperty.call(changes, 'endAt')
      return {
        ...item,
        ...changes,
        start: startChanged ? changes.startAt?.slice(11, 16) : item.start,
        end: endChanged ? changes.endAt?.slice(11, 16) : item.end,
        unscheduled: startChanged ? !changes.startAt : item.unscheduled,
      }
    }))
    return true
  }

  async function startNowTask(task: Task) {
    const resumingRescue = task.focusSession?.sessionType === 'rescue' && task.focusSession.status === 'paused'
    if (resumingRescue) {
      if (!await focusTask(task.id, 'resume')) return
    } else if (task.isFocus) {
      const action: FocusAction = task.focusSession?.status === 'paused' ? 'resume' : 'start'
      if (!await focusTask(task.id, action)) return
    }
    if (await updateExecutionTask(task, { status: 'in_progress' })) {
      showToast(resumingRescue ? '继续这一小步，不用想后面的事' : task.isFocus ? '专注开始，只做这一件' : '已经开始，做完再看下一项')
    }
  }

  async function pauseNowTask(task: Task) {
    if (task.focusSession?.status !== 'running' || (!task.isFocus && task.focusSession.sessionType !== 'rescue')) return
    if (await focusTask(task.id, 'pause')) showToast(task.focusSession.sessionType === 'rescue' ? '这一小步已暂停，时间会保留' : '专注已暂停，时间会保留')
  }

  async function startRescue(input: RescueInput) {
    const task = tasks.find((item) => item.id === rescueTaskId)
    if (!task) throw new Error('当前任务已经变化，请重新打开救援模式。')
    await prepareFocusPresenceDetection()
    if (!demoMode) {
      const updated = await api.startRescue(task.id, input)
      setTasks((current) => current.map((item) => item.id === task.id ? updated : item))
    } else {
      const timestamp = new Date().toISOString()
      setTasks((current) => current.map((item) => item.id === task.id ? {
        ...item,
        status: 'in_progress',
        focusSession: {
          id: Date.now(),
          sessionType: 'rescue',
          status: 'running',
          plannedSeconds: input.durationMinutes * 60,
          elapsedSeconds: 0,
          rescueReason: input.reason,
          rescueStep: input.step,
          rescueOutcome: null,
          startedAt: timestamp,
          lastResumedAt: timestamp,
        },
      } : item))
    }
    setRescueTaskId(null)
    showToast(`先做 ${input.durationMinutes} 分钟，只完成这一小步`)
  }

  async function finishRescue(task: Task, outcome: RescueOutcome) {
    if (!demoMode) {
      const updated = await api.finishRescue(task.id, outcome)
      setTasks((current) => current.map((item) => item.id === task.id ? updated : item))
      void api.bootstrap().then((data) => setReview(data.review)).catch(() => undefined)
    } else {
      const timestamp = new Date().toISOString()
      const nowMinutes = berlinClockMinutes()
      setTasks((current) => current.map((item) => {
        if (item.id !== task.id || item.focusSession?.sessionType !== 'rescue') return item
        const session = item.focusSession
        const runningDelta = session.status === 'running' && session.lastResumedAt
          ? Math.max(0, Math.floor((Date.now() - new Date(session.lastResumedAt).getTime()) / 1000))
          : 0
        if (outcome === 'continue') {
          return {
            ...item,
            status: 'in_progress',
            focusSession: item.isFocus ? {
              id: Date.now(),
              sessionType: 'focus',
              status: 'running',
              plannedSeconds: item.duration * 60,
              elapsedSeconds: 0,
              startedAt: timestamp,
              lastResumedAt: timestamp,
            } : {
              ...session,
              status: 'completed',
              rescueOutcome: 'continue',
              elapsedSeconds: session.elapsedSeconds + runningDelta,
              lastResumedAt: null,
              endedAt: timestamp,
            },
          }
        }
        const startAt = localDateTime(berlinIsoDate(), nowMinutes + 30)
        return {
          ...item,
          status: 'planned',
          startAt,
          endAt: localDateTime(berlinIsoDate(), nowMinutes + 30 + item.duration),
          start: startAt.slice(11, 16),
          end: localDateTime(berlinIsoDate(), nowMinutes + 30 + item.duration).slice(11, 16),
          scheduleBlocks: [],
          focusSession: {
            ...session,
            status: 'completed',
            rescueOutcome: 'later',
            elapsedSeconds: session.elapsedSeconds + runningDelta,
            lastResumedAt: null,
            endedAt: timestamp,
          },
        }
      }))
    }
    showToast(outcome === 'continue' ? '已经启动，继续原任务' : '先放一放，30 分钟后再回来')
  }

  async function completeNowTask(task: Task) {
    setCompletionTaskId(task.id)
  }

  async function delayNowTask(task: Task, delayMinutes: number) {
    if (task.isFocus && (task.focusSession?.status === 'running' || task.focusSession?.status === 'paused')) {
      if (!await focusTask(task.id, 'end')) return
    }
    const today = berlinIsoDate()
    const scheduledDate = taskCalendarDate(task)
    const nowMinutes = berlinClockMinutes()
    const existingStart = scheduledDate === today ? taskStartMinutes(task) : null
    const delayedStart = Math.max(nowMinutes, existingStart ?? nowMinutes) + delayMinutes
    const startAt = localDateTime(today, delayedStart)
    const endAt = localDateTime(today, delayedStart + task.duration)
    const updated = await updateExecutionTask(task, { startAt, endAt, status: 'planned', updateScope: 'single' })
    if (updated) showToast(`已延后 ${delayMinutes} 分钟，只调整这一次`)
  }

  async function snoozeTaskReminder(task: Task, minutes: 10 | 30) {
    try {
      if (!demoMode) {
        const updated = await api.snoozeTask(task.id, minutes)
        setTasks((current) => current.map((item) => item.id === task.id ? updated : item))
        showToast(`将在 ${taskMoment(updated.reminderAt)} 再次提醒`)
        return
      }
      const reminderAt = new Date(Date.now() + minutes * 60_000).toISOString()
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, reminderAt } : item))
      showToast(`将在 ${taskMoment(reminderAt)} 再次提醒`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '稍后提醒设置失败')
    }
  }

  async function skipNowTask(task: Task) {
    if (task.isFocus && (task.focusSession?.status === 'running' || task.focusSession?.status === 'paused')) {
      if (!await focusTask(task.id, 'end')) return
    }
    if (task.recurrenceRule) {
      await skipRecurringTask(task.id)
      return
    }
    const updated = await updateExecutionTask(task, { startAt: null, endAt: null, status: 'inbox' })
    if (updated) showToast('已移出今天，任务仍保留在收集箱')
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

  async function prepareFocusPresenceDetection() {
    if (!window.IdleDetector) {
      setIdlePermission('unsupported')
      return
    }
    if (idlePermission === 'granted' || idlePermission === 'denied') return
    try {
      const permission = await window.IdleDetector.requestPermission()
      setIdlePermission(permission)
      if (permission === 'granted' && 'Notification' in window && Notification.permission === 'default') {
        try {
          await Notification.requestPermission()
        } catch {
          // Native notifications are optional; the in-app confirmation still works.
        }
      }
    } catch {
      setIdlePermission('denied')
    }
  }

  async function focusTask(taskId: number, action: FocusAction, idleSeconds = 0): Promise<boolean> {
    const task = tasks.find((item) => item.id === taskId)
    if (!task) return false

    if (action === 'start' || action === 'resume') {
      await prepareFocusPresenceDetection()
    }

    if (!demoMode) {
      try {
        const updated = await api.focusTask(taskId, action, idleSeconds)
        setTasks((current) => current.map((item) => item.id === taskId ? updated : item))
        return true
      } catch (error) {
        showToast(error instanceof Error ? error.message : '专注计时保存失败')
        return false
      }
    }

    const timestamp = new Date().toISOString()
    setTasks((current) => current.map((item) => {
      if (item.id !== taskId) return item
      const session = item.focusSession
      const runningDelta = session?.status === 'running' && session.lastResumedAt
        ? Math.max(0, Math.floor((Date.now() - new Date(session.lastResumedAt).getTime()) / 1000))
        : 0
      if (action === 'start' && (!session || session.status === 'completed')) {
        return { ...item, focusSession: { id: Date.now(), sessionType: 'focus', status: 'running', plannedSeconds: item.duration * 60, elapsedSeconds: 0, startedAt: timestamp, lastResumedAt: timestamp } }
      }
      if (!session || session.status === 'completed') return item
      if (action === 'pause' && session.status === 'running') {
        return { ...item, focusSession: { ...session, status: 'paused', elapsedSeconds: Math.max(0, session.elapsedSeconds + runningDelta - idleSeconds), lastResumedAt: null } }
      }
      if (action === 'resume' && session.status === 'paused') {
        return { ...item, focusSession: { ...session, status: 'running', lastResumedAt: timestamp } }
      }
      if (action === 'end') {
        return { ...item, focusSession: { ...session, status: 'completed', elapsedSeconds: session.elapsedSeconds + runningDelta, lastResumedAt: null, endedAt: timestamp } }
      }
      return item
    }))
    return true
  }

  function dismissIdleWarning() {
    idleWarningRef.current = null
    setIdleWarning(null)
    idleNotification.current?.close()
    idleNotification.current = null
    document.title = baseDocumentTitle.current
  }

  function presentIdleWarning(task: Task) {
    if (idleWarningRef.current) return
    const detectedAt = Date.now()
    const warning = {
      taskId: task.id,
      taskTitle: task.title,
      detectedAt,
      deadlineAt: detectedAt + focusIdleConfirmationSeconds * 1000,
    }
    idleWarningRef.current = warning
    setIdleClock(detectedAt)
    setIdleWarning(warning)
    document.title = '还在专注吗？'

    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('还在专注吗？', {
        body: '60 秒内回到人生看板确认，否则会自动暂停并扣除离开时间。',
        tag: 'life-focus-idle',
        requireInteraction: true,
      })
      notification.onclick = () => {
        window.focus()
        notification.close()
      }
      idleNotification.current = notification
    }
  }

  async function pauseForIdle(warning: FocusIdleWarning | null, locked = false) {
    const task = runningFocusTask
    if (!task || idlePauseInFlight.current) return
    idlePauseInFlight.current = true
    const idleSeconds = warning
      ? Math.min(
          focusIdleThresholdSeconds + focusIdleConfirmationSeconds,
          focusIdleThresholdSeconds + Math.max(0, Math.floor((Date.now() - warning.detectedAt) / 1000)),
        )
      : 0
    const paused = await focusTask(task.id, 'pause', idleSeconds)
    if (paused) {
      showToast(locked ? '屏幕已锁定，专注计时已自动暂停' : '检测到离开，专注计时已自动暂停')
    }
    dismissIdleWarning()
    idlePauseInFlight.current = false
  }

  useEffect(() => {
    if (!idleWarning) return undefined
    const updateClock = window.setInterval(() => setIdleClock(Date.now()), 1000)
    const autoPause = window.setTimeout(() => void pauseForIdle(idleWarning), Math.max(0, idleWarning.deadlineAt - Date.now()))
    return () => {
      window.clearInterval(updateClock)
      window.clearTimeout(autoPause)
    }
  }, [idleWarning?.deadlineAt])

  useEffect(() => {
    if (!runningFocusTask || idlePermission !== 'granted' || !window.IdleDetector) return undefined
    const controller = new AbortController()
    const detector = new window.IdleDetector()
    const handleIdleChange = () => {
      if (detector.screenState === 'locked') {
        void pauseForIdle(idleWarningRef.current, true)
        return
      }
      if (detector.userState === 'idle') {
        presentIdleWarning(runningFocusTask)
      } else if (detector.userState === 'active' && idleWarningRef.current?.taskId === runningFocusTask.id) {
        dismissIdleWarning()
      }
    }
    detector.addEventListener('change', handleIdleChange)
    void detector.start({ threshold: focusIdleThresholdSeconds * 1000, signal: controller.signal })
      .catch(() => setIdlePermission('denied'))
    return () => {
      controller.abort()
      detector.removeEventListener('change', handleIdleChange)
      if (idleWarningRef.current?.taskId === runningFocusTask.id) {
        dismissIdleWarning()
      }
    }
  }, [runningFocusTask?.id, idlePermission])

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
      downloadJson(data, `life-dashboard-${new Date().toISOString().slice(0, 10)}.json`)
      showToast('数据备份已导出')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '数据导出失败')
    }
  }

  async function clearTasksAndHabits() {
    if (demoMode) {
      setTasks([])
      setHabits([])
      setDailyRhythm((current) => ({ ...current, focusTaskId: null, focusTaskTitle: null }))
    } else {
      applyBootstrap(await api.clearTasksAndHabits())
    }
    setSelectedTaskId(null)
    setCompletionTaskId(null)
    setRescueTaskId(null)
    showToast(demoMode ? '演示任务和习惯已清空' : '任务和习惯已清空，清空前备份已保存')
  }

  async function createBackup() {
    if (demoMode) {
      showToast('演示模式不会写入服务器备份')
      return
    }
    applyBootstrap(await api.createBackup())
    showToast('服务器备份已创建')
  }

  async function previewBackup(backup: Record<string, unknown>) {
    if (demoMode) throw new Error('演示模式不能恢复备份。')
    return api.previewBackup(backup)
  }

  async function previewStoredBackup(id: number) {
    return api.previewBackup(await api.downloadStoredBackup(id))
  }

  async function downloadCurrentBeforeRestore() {
    const current = await api.exportData()
    downloadJson(current, `life-dashboard-before-restore-${new Date().toISOString().slice(0, 10)}.json`)
  }

  async function restoreBackup(backup: Record<string, unknown>, password: string) {
    await downloadCurrentBeforeRestore()
    applyBootstrap(await api.restoreBackup(backup, password))
    showToast('完整备份已恢复')
  }

  async function restoreStoredBackup(id: number, password: string) {
    await downloadCurrentBeforeRestore()
    applyBootstrap(await api.restoreStoredBackup(id, password))
    showToast('服务器备份已恢复')
  }

  async function downloadStoredBackup(backup: BackupRecord) {
    downloadJson(await api.downloadStoredBackup(backup.id), backup.fileName)
    showToast('服务器备份已下载')
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

  async function skipRecurringTask(id: number) {
    if (demoMode) {
      setTasks((current) => current.map((task) => task.id === id ? { ...task, skipped: true, status: 'cancelled' } : task))
    } else {
      applyBootstrap(await api.skipRecurringTask(id))
    }
    setSelectedTaskId(null)
    showToast('已跳过这一次，不会计入完成率')
  }

  async function pauseRecurringTask(id: number, pausedUntil: string) {
    if (demoMode) {
      setTasks((current) => current.map((task) => task.recurrenceSeriesId === tasks.find((item) => item.id === id)?.recurrenceSeriesId ? { ...task, recurrencePausedUntil: pausedUntil } : task))
    } else {
      applyBootstrap(await api.pauseRecurringTask(id, pausedUntil))
    }
    setSelectedTaskId(null)
    showToast(`循环任务已暂停至 ${pausedUntil}`)
  }

  function openDailyFlow() {
    if (dailyRhythm.closedAt) {
      showToast('今天已经收尾，可以安心休息了')
      return
    }
    setDailyFlow(dailyRhythm.morningStatus === 'pending' ? 'morning' : 'evening')
  }

  async function saveMorningCheckin(input: MorningCheckinInput, organize: boolean) {
    if (demoMode) {
      const focusTask = tasks.find((task) => task.id === input.focusTaskId)
      setDailyRhythm((current) => ({
        ...current,
        wakeTime: input.wakeTime,
        hadBreakfast: input.hadBreakfast,
        morningEnergy: input.energy,
        focusTaskId: input.focusTaskId,
        focusTaskTitle: focusTask?.title ?? null,
        morningStatus: 'completed',
        morningCompletedAt: new Date().toISOString(),
        morningStreak: Math.max(1, current.morningStreak + (current.morningCompletedAt ? 0 : 1)),
      }))
    } else {
      applyBootstrap(await api.saveMorning(input))
    }
    setDailyFlow(null)
    showToast('晨间启动已记录')
    if (organize) openAiPlanner()
  }

  async function skipMorningCheckin() {
    if (demoMode) {
      setDailyRhythm((current) => ({ ...current, morningStatus: 'skipped' }))
    } else {
      applyBootstrap(await api.skipMorning())
    }
    setDailyFlow(null)
    showToast('今天已跳过晨间启动')
  }

  async function closeDailyRhythm(energy: number, reflection: string, decisions: EveningDecision[]) {
    if (demoMode) {
      const decisionMap = new Map(decisions.map((decision) => [decision.taskId, decision.action]))
      const tomorrow = shiftIsoDate(berlinIsoDate(), 1)
      setTasks((current) => current.map((task) => {
        const action = decisionMap.get(task.id)
        if (!action) return task
        if (action === 'drop') return { ...task, status: 'cancelled', skipped: true, focusSession: task.focusSession ? { ...task.focusSession, status: 'completed', endedAt: new Date().toISOString(), lastResumedAt: null } : null }
        if (action === 'later') return { ...task, status: 'inbox', startAt: null, endAt: null, start: undefined, end: undefined, unscheduled: true, scheduleMode: 'flexible' }
        const start = taskStartMinutes(task) ?? 9 * 60
        return {
          ...task,
          status: 'planned',
          startAt: localDateTime(tomorrow, start),
          endAt: localDateTime(tomorrow, start + task.duration),
          start: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
          end: `${String(Math.floor((start + task.duration) / 60) % 24).padStart(2, '0')}:${String((start + task.duration) % 60).padStart(2, '0')}`,
          unscheduled: false,
        }
      }))
      setDailyRhythm((current) => ({
        ...current,
        eveningEnergy: energy,
        reflection,
        closedAt: new Date().toISOString(),
        eveningStreak: Math.max(1, current.eveningStreak + (current.closedAt ? 0 : 1)),
      }))
    } else {
      applyBootstrap(await api.closeDay(energy, reflection, decisions))
    }
    setDailyFlow(null)
    showToast('今天已经收好，剩下的时间留给休息')
  }

  async function saveTask(draft: TaskDraft) {
    if (!demoMode) {
      if (draft.id) {
        const result = await api.updateTask(draft as Partial<Task> & { id: number; updateScope?: 'single' | 'future' })
        setTasks((current) => current.map((task) => task.id === draft.id ? result.task : task))
        if (result.nextTask) setTasks((current) => current.some((task) => task.id === result.nextTask?.id) ? current : [...current, result.nextTask as Task])
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
      isFocus: draft.isFocus ?? false,
      focusSession: existing?.focusSession ?? null,
      completed: existing?.completed ?? false,
      unscheduled: !draft.startAt,
      recurrenceRule: draft.recurrenceRule,
      scheduleMode: draft.scheduleMode,
      windowStart: draft.windowStart,
      windowEnd: draft.windowEnd,
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

  const idleSecondsLeft = idleWarning
    ? Math.max(0, Math.ceil((idleWarning.deadlineAt - idleClock) / 1000))
    : 0

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
        {page === 'now' && <NowPage tasks={tasks} dailyRhythm={dailyRhythm} idlePermission={idlePermission} onStart={startNowTask} onPause={pauseNowTask} onComplete={completeNowTask} onDelay={delayNowTask} onSkip={skipNowTask} onOpenTask={openTask} onNavigate={navigate} onRebalance={openRebalanceSetup} onOpenRescue={(task) => setRescueTaskId(task.id)} onFinishRescue={finishRescue} />}
        {page === 'today' && <TodayPage tasks={tasks} habits={habits} projects={projectItems} dailyRhythm={dailyRhythm} quickEntry={quickEntry} setQuickEntry={setQuickEntry} addTask={addTask} toggleTask={toggleTask} toggleHabit={toggleHabit} onOpenTask={openTask} onScheduleTask={(id) => editTask(id, true)} onNavigate={navigate} onRebalance={openRebalanceSetup} onOpenDailyFlow={openDailyFlow} />}
        {page === 'inbox' && <InboxPage tasks={tasks} quickEntry={quickEntry} setQuickEntry={setQuickEntry} addTask={addTask} toggleTask={toggleTask} onNewTask={() => setEditor({ type: 'task' })} onOpenTask={openTask} onScheduleTask={(id) => editTask(id, true)} />}
        {page === 'calendar' && <CalendarPage tasks={tasks} onNewTask={() => setEditor({ type: 'task', schedule: true })} onOpenTask={openTask} />}
        {page === 'projects' && <ProjectsPage projects={projectItems} onNewProject={() => setEditor({ type: 'project' })} />}
        {page === 'habits' && <HabitsPage habits={habits} toggleHabit={toggleHabit} onNewHabit={() => setEditor({ type: 'habit' })} />}
        {page === 'review' && <ReviewPage summary={review} tasks={tasks} onAiPlan={() => openAiPlanner('next_week')} />}
        {page === 'settings' && <SettingsPage settings={settings} browserPush={browserPush} activeSection={settingsSection} dataCounts={{ tasks: tasks.length, projects: projectItems.length, habits: habits.length, categories: categories.length }} planImports={planImports} backups={backups} onSectionChange={navigateSettings} onSave={saveSettings} onEnablePush={enableBrowserPush} onDisablePush={disableBrowserPush} onTestPush={testBrowserPush} onTestMail={testMail} onChangePassword={changePassword} onExportData={exportData} onClearTasksAndHabits={clearTasksAndHabits} onCreateBackup={createBackup} onPreviewBackup={previewBackup} onPreviewStoredBackup={previewStoredBackup} onRestoreBackup={restoreBackup} onRestoreStoredBackup={restoreStoredBackup} onDownloadStoredBackup={downloadStoredBackup} onImportPlan={importPlan} onDeletePlanImport={deletePlanImport} onLogout={logout} />}
      </div>
      <MobileNav page={page} setPage={navigate} />
      {selectedTask && <TaskDetail task={selectedTask} idlePermission={idlePermission} onClose={() => setSelectedTaskId(null)} onEdit={() => editTask(selectedTask.id)} onSchedule={() => editTask(selectedTask.id, true)} onDelete={() => deleteTask(selectedTask.id)} onToggle={() => toggleTask(selectedTask.id)} onStart={() => startNowTask(selectedTask)} onComplete={() => { setSelectedTaskId(null); setCompletionTaskId(selectedTask.id) }} onSnooze={(minutes) => snoozeTaskReminder(selectedTask, minutes)} onRescue={() => { setSelectedTaskId(null); setRescueTaskId(selectedTask.id) }} onToggleSubtask={(subtask) => toggleSubtask(selectedTask.id, subtask)} onFocusAction={(action) => focusTask(selectedTask.id, action)} onSkipOccurrence={() => skipRecurringTask(selectedTask.id)} onPauseSeries={(date) => pauseRecurringTask(selectedTask.id, date)} />}
      {editor?.type === 'task' && <TaskEditor task={editorTask} schedule={editor.schedule} projects={projectItems} categories={categories} defaultReminderMinutes={settings.taskReminderMinutes} onClose={() => setEditor(null)} onSave={saveTask} />}
      {editor?.type === 'project' && <ProjectEditor onClose={() => setEditor(null)} onSave={saveProject} />}
      {editor?.type === 'habit' && <HabitEditor onClose={() => setEditor(null)} onSave={saveHabit} />}
      {dailyFlow === 'morning' && !selectedTask && <MorningCheckinModal rhythm={dailyRhythm} tasks={tasks} onClose={() => setDailyFlow(null)} onSave={saveMorningCheckin} onSkip={skipMorningCheckin} />}
      {dailyFlow === 'evening' && !selectedTask && <EveningCheckinModal rhythm={dailyRhythm} tasks={tasks} onClose={() => setDailyFlow(null)} onSave={closeDailyRhythm} />}
      {completionTask && <CompletionCalibrationModal task={completionTask} onClose={() => setCompletionTaskId(null)} onSave={completeTask} />}
      {rescueTask && <RescueSetupModal task={rescueTask} onClose={() => setRescueTaskId(null)} onStart={startRescue} />}
      {rebalanceSetupOpen && <RebalanceSetupModal tasks={tasks} dailyRhythm={dailyRhythm} settings={settings} onClose={() => setRebalanceSetupOpen(false)} onGenerate={startRebalance} />}
      {aiPlannerOpen && <AiPlannerModal scope={aiPlanScope} plan={aiPlan} loading={aiPlanLoading} applying={aiPlanApplying} error={aiPlanError} onClose={() => setAiPlannerOpen(false)} onRetry={() => void generateAiPlan(aiPlanScope, aiPlanScope === 'rebalance' ? rebalanceInput : null)} onApply={() => void applyAiPlan()} />}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
      {idleWarning && <FocusIdleWarningDialog warning={idleWarning} secondsLeft={idleSecondsLeft} onContinue={dismissIdleWarning} onPause={() => void pauseForIdle(idleWarning)} />}
    </div>
  )
}
