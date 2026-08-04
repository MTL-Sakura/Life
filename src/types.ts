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
  reminderMinutes?: number | null
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
}

export type ReviewSummary = {
  total: number
  completed: number
  completionRate: number
  completedMinutes: number
  overdue: number
}

export type BootstrapData = {
  tasks: Task[]
  habits: Habit[]
  projects: Project[]
  categories: Category[]
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
