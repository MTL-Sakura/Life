export type PageKey =
  | 'today'
  | 'inbox'
  | 'calendar'
  | 'projects'
  | 'habits'
  | 'review'
  | 'settings'

export type Priority = 'high' | 'medium' | 'low'

export type Subtask = {
  id: number
  title: string
  completed: boolean
  position: number
}

export type FocusSessionStatus = 'running' | 'paused' | 'completed'

export type FocusSession = {
  id: number
  status: FocusSessionStatus
  plannedSeconds: number
  elapsedSeconds: number
  startedAt: string
  lastResumedAt?: string | null
  endedAt?: string | null
}

export type ScheduleBlock = {
  id: number
  startAt: string
  endAt: string
  start: string
  end: string
  source: 'manual' | 'ai'
  position: number
}

export type Task = {
  id: number
  title: string
  project: string
  category: string
  color: string
  priority: Priority
  start?: string
  end?: string
  due?: string
  duration: number
  isFocus?: boolean
  focusSession?: FocusSession | null
  completed: boolean
  unscheduled?: boolean
  status?: 'inbox' | 'planned' | 'in_progress' | 'completed' | 'cancelled'
  notes?: string
  projectId?: number | null
  categoryId?: number | null
  startAt?: string | null
  endAt?: string | null
  dueAt?: string | null
  recurrenceRule?: string | null
  recurrenceSourceTaskId?: number | null
  recurrenceSeriesId?: number | null
  recurrencePausedUntil?: string | null
  skipped?: boolean
  scheduleMode?: 'fixed' | 'window' | 'flexible'
  windowStart?: string | null
  windowEnd?: string | null
  scheduleBlocks?: ScheduleBlock[]
  reminderMinutes?: number | null
  completedAt?: string | null
  subtasks?: Subtask[]
}

export type Habit = {
  id: number
  name: string
  detail: string
  color: string
  streak: number
  checked: boolean[]
  description?: string
  frequencyType?: 'daily' | 'weekly' | 'custom'
  targetCount?: number
  scheduleDays?: number[]
  allowMakeup?: boolean
}

export type Project = {
  id: number
  title: string
  area: string
  color: string
  progress: number
  due: string
  currentStage: string
  completedTasks: number
  totalTasks: number
  stages: string[]
  description?: string
  status?: 'active' | 'paused' | 'completed' | 'archived'
  dueAt?: string | null
}

export type Category = {
  id: number
  name: string
  color: string
}

export type UserSettings = {
  displayName: string
  email: string
  timezone: string
  emailReminders: boolean
  dailySummary: boolean
  dailySummaryTime: string
  overdueReminder: boolean
  taskReminderMinutes: number
  weekStartsOn: 'monday' | 'sunday'
  planningStartTime: string
  planningEndTime: string
  lunchStartTime: string
  lunchEndTime: string
  dinnerStartTime: string
  dinnerEndTime: string
  planningBufferMinutes: number
}

export type ReviewSummary = {
  total: number
  completed: number
  completionRate: number
  completedMinutes: number
  overdue: number
}

export type AiPlanItem = {
  taskId: number
  title: string
  startAt: string
  endAt: string
  duration: number
  priority: Priority
  reason: string
  blocks: Array<{
    startAt: string
    endAt: string
    duration: number
  }>
}

export type AiPlanSkippedItem = {
  taskId: number
  title: string
  reason: string
}

export type AiPlan = {
  id: number
  model: string
  summary: string
  items: AiPlanItem[]
  skipped: AiPlanSkippedItem[]
  remainingUses: number
  expiresAt: string
}

export type PlanImportDocument = {
  schemaVersion: 1
  importKey: string
  name?: string
  startDate?: 'today' | 'tomorrow' | string
  timezone?: string
  categories?: Array<{ name: string; color?: string }>
  projects?: Array<{
    key: string
    title: string
    description?: string
    area?: string
    color?: string
    currentStage?: string
    stages?: string[]
  }>
  habits?: Array<{
    name: string
    description?: string
    color?: string
    frequency?: 'daily' | 'weekly' | 'custom'
    targetCount?: number
    scheduleDays?: number[]
    reminderTime?: string | null
    allowMakeup?: boolean
  }>
  tasks?: Array<{
    title: string
    notes?: string
    projectKey?: string | null
    category?: string | null
    priority?: Priority
    duration?: number
    focus?: boolean
    dateOffset?: number
    weekday?: number | null
    startTime?: string | null
    dueTime?: string | null
    recurrence?: 'none' | 'daily' | 'weekly' | 'monthly'
    reminderMinutes?: number
    subtasks?: string[]
  }>
}

export type PlanImportCounts = {
  categories: number
  projects: number
  habits: number
  tasks: number
}

export type PlanImportBatch = {
  id: number
  importKey: string
  name: string
  counts: PlanImportCounts
  createdAt: string
}

export type PlanImportResult = BootstrapData & { imported: PlanImportCounts }

export type BackupRecord = {
  id: number
  kind: 'manual' | 'daily' | 'weekly' | 'pre_restore'
  fileName: string
  sizeBytes: number
  schemaVersion: number
  createdAt: string
}

export type BackupPreview = {
  schemaVersion: number
  exportedAt: string
  timezone: string
  counts: {
    tasks: number
    projects: number
    habits: number
    categories: number
    focusSessions: number
  }
}

export type BootstrapData = {
  tasks: Task[]
  habits: Habit[]
  projects: Project[]
  categories: Category[]
  planImports: PlanImportBatch[]
  backups: BackupRecord[]
  settings: UserSettings
  review: ReviewSummary
  csrfToken: string
}

export type SessionUser = {
  id: number
  username: string
  email: string
  displayName: string
  timezone: string
}
