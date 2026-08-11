import type { AiPlan, BackupPreview, BootstrapData, EveningDecision, Habit, MorningCheckinInput, PlanImportDocument, PlanImportResult, Project, RebalanceInput, SessionUser, Subtask, Task, UserSettings } from './types'

let csrfToken: string | null = null

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
}

async function request<T>(action: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const response = await fetch(`/api/index.php?action=${encodeURIComponent(action)}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'GET' || csrfToken === null ? {} : { 'X-CSRF-Token': csrfToken }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new Error('API_UNAVAILABLE')
  }

  const data = await response.json() as T & { error?: string; csrfToken?: string }
  if (data.csrfToken) csrfToken = data.csrfToken
  if (!response.ok) throw new Error(data.error ?? '请求失败，请稍后重试。')
  return data
}

export const api = {
  async session(): Promise<{ authenticated: boolean; user: SessionUser | null; csrfToken: string | null }> {
    const result = await request<{ authenticated: boolean; user: SessionUser | null; csrfToken: string | null }>('session')
    if (result.csrfToken) csrfToken = result.csrfToken
    return result
  },

  async login(username: string, password: string): Promise<SessionUser> {
    const result = await request<{ user: SessionUser; csrfToken: string }>('login', { method: 'POST', body: { username, password } })
    csrfToken = result.csrfToken
    return result.user
  },

  async logout(): Promise<void> {
    await request('logout', { method: 'POST' })
    csrfToken = null
  },

  async bootstrap(): Promise<BootstrapData> {
    const result = await request<BootstrapData>('bootstrap')
    csrfToken = result.csrfToken
    return result
  },

  async createTask(input: Omit<Partial<Task>, 'subtasks'> & { title: string; subtasks?: Array<Partial<Subtask> & { title: string }> }): Promise<Task> {
    const result = await request<{ task: Task }>('tasks.create', { method: 'POST', body: input })
    return result.task
  },

  async updateTask(input: Partial<Task> & { id: number; updateScope?: 'single' | 'future' }): Promise<{ task: Task; nextTask?: Task }> {
    return request<{ task: Task; nextTask?: Task }>('tasks.update', { method: 'PATCH', body: input })
  },

  async deleteTask(id: number): Promise<void> {
    await request('tasks.delete', { method: 'DELETE', body: { id } })
  },

  async skipRecurringTask(id: number): Promise<BootstrapData> {
    return request<BootstrapData>('tasks.recurrence.skip', { method: 'POST', body: { id } })
  },

  async pauseRecurringTask(id: number, pausedUntil: string): Promise<BootstrapData> {
    return request<BootstrapData>('tasks.recurrence.pause', { method: 'POST', body: { id, pausedUntil } })
  },

  async updateSubtask(taskId: number, id: number, completed: boolean): Promise<Task> {
    const result = await request<{ task: Task }>('tasks.subtask', { method: 'PATCH', body: { taskId, id, completed } })
    return result.task
  },

  async focusTask(taskId: number, action: 'start' | 'pause' | 'resume' | 'end', idleSeconds = 0): Promise<Task> {
    const result = await request<{ task: Task }>(`focus.${action}`, { method: 'POST', body: { taskId, idleSeconds } })
    return result.task
  },

  async saveMorning(input: MorningCheckinInput): Promise<BootstrapData> {
    return request<BootstrapData>('daily.morning', { method: 'POST', body: input })
  },

  async skipMorning(): Promise<BootstrapData> {
    return request<BootstrapData>('daily.morning.skip', { method: 'POST', body: {} })
  },

  async closeDay(energy: number, reflection: string, decisions: EveningDecision[]): Promise<BootstrapData> {
    return request<BootstrapData>('daily.close', { method: 'POST', body: { energy, reflection, decisions } })
  },

  async createHabit(input: Partial<Habit> & { name: string }): Promise<BootstrapData> {
    return request<BootstrapData>('habits.create', { method: 'POST', body: input })
  },

  async checkHabit(id: number, date: string, checked: boolean): Promise<void> {
    await request('habits.checkin', { method: 'POST', body: { id, date, checked } })
  },

  async createProject(input: Partial<Project> & { title: string }): Promise<BootstrapData> {
    return request<BootstrapData>('projects.create', { method: 'POST', body: input })
  },

  async updateSettings(settings: UserSettings): Promise<void> {
    await request('settings.update', { method: 'PATCH', body: settings })
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request('account.password', { method: 'PATCH', body: { currentPassword, newPassword } })
  },

  async exportData(): Promise<Record<string, unknown>> {
    return request<Record<string, unknown>>('data.export')
  },

  async createBackup(): Promise<BootstrapData> {
    return request<BootstrapData>('backup.create', { method: 'POST', body: {} })
  },

  async previewBackup(backup: Record<string, unknown>): Promise<BackupPreview> {
    const result = await request<{ preview: BackupPreview }>('backup.preview', { method: 'POST', body: { backup } })
    return result.preview
  },

  async restoreBackup(backup: Record<string, unknown>, password: string): Promise<BootstrapData> {
    return request<BootstrapData>('backup.restore', { method: 'POST', body: { backup, password } })
  },

  async restoreStoredBackup(id: number, password: string): Promise<BootstrapData> {
    return request<BootstrapData>('backup.restore.stored', { method: 'POST', body: { id, password } })
  },

  async downloadStoredBackup(id: number): Promise<Record<string, unknown>> {
    return request<Record<string, unknown>>('backup.download', { method: 'POST', body: { id } })
  },

  async importPlan(plan: PlanImportDocument): Promise<PlanImportResult> {
    return request<PlanImportResult>('data.import', { method: 'POST', body: { plan } })
  },

  async deletePlanImport(id: number): Promise<BootstrapData> {
    return request<BootstrapData>('data.import.delete', { method: 'DELETE', body: { id } })
  },

  async testMail(): Promise<void> {
    await request('mail.test', { method: 'POST' })
  },

  async createAiPlan(): Promise<AiPlan> {
    const result = await request<{ plan: AiPlan }>('ai.plan', { method: 'POST', body: {} })
    return result.plan
  },

  async createWeeklyAiPlan(): Promise<AiPlan> {
    const result = await request<{ plan: AiPlan }>('ai.plan.week', { method: 'POST', body: {} })
    return result.plan
  },

  async createRebalancePlan(input: RebalanceInput): Promise<AiPlan> {
    const result = await request<{ plan: AiPlan }>('ai.plan.rebalance', { method: 'POST', body: input })
    return result.plan
  },

  async applyAiPlan(planId: number): Promise<BootstrapData> {
    return request<BootstrapData>('ai.apply', { method: 'POST', body: { planId } })
  },
}
