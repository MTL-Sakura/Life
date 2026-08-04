import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  AlarmClock,
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Dumbbell,
  Eye,
  EyeOff,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  TimerReset,
  TrendingUp,
  User,
  X,
} from 'lucide-react'
import { api } from './api'
import { initialHabits, initialTasks, projects as initialProjects, weekDays } from './mockData'
import type { BootstrapData, Category, Habit, PageKey, Project, ReviewSummary, Task, UserSettings } from './types'

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
  total: 35,
  completed: 24,
  completionRate: 68,
  completedMinutes: 1235,
  overdue: 3,
}

const palette = ['#496d5b', '#b96552', '#58748f', '#a1843e', '#7a6b87']

type TaskDraft = Partial<Task> & {
  title: string
  subtasks?: string[]
}

function berlinDate() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Berlin',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())
}

function currentWeekDates() {
  const now = new Date()
  const mondayOffset = (now.getDay() + 6) % 7
  const monday = new Date(now)
  monday.setDate(now.getDate() - mondayOffset)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    return date.getDate()
  })
}

function currentWeekDateIso(dayIndex: number) {
  const now = new Date()
  const mondayOffset = (now.getDay() + 6) % 7
  const date = new Date(now)
  date.setHours(12, 0, 0, 0)
  date.setDate(now.getDate() - mondayOffset + dayIndex)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

function TaskEditor({ projects, categories, defaultReminderMinutes, onClose, onSave }: {
  projects: Project[]
  categories: Category[]
  defaultReminderMinutes: number
  onClose: () => void
  onSave: (task: TaskDraft) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [projectId, setProjectId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [dueAt, setDueAt] = useState('')
  const [duration, setDuration] = useState(30)
  const [recurrenceRule, setRecurrenceRule] = useState('')
  const [reminderMinutes, setReminderMinutes] = useState(defaultReminderMinutes)
  const [subtasks, setSubtasks] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        notes: notes.trim(),
        projectId: projectId ? Number(projectId) : null,
        categoryId: categoryId ? Number(categoryId) : null,
        priority,
        duration,
        startAt: date ? `${date}T${startTime}:00` : null,
        endAt: date ? `${date}T${endTime}:00` : null,
        dueAt: dueAt || null,
        recurrenceRule: recurrenceRule || null,
        reminderMinutes: date ? reminderMinutes : null,
        subtasks: subtasks.split('\n').map((item) => item.trim()).filter(Boolean),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell title="新建任务" eyebrow="TASK" onClose={onClose}>
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
          <label><span>重复</span><select value={recurrenceRule} onChange={(event) => setRecurrenceRule(event.target.value)}><option value="">不重复</option><option value="FREQ=DAILY">每天</option><option value="FREQ=WEEKLY">每周</option><option value="FREQ=MONTHLY">每月</option></select></label>
          <label><span>提前提醒（分钟）</span><input type="number" min="0" max="10080" value={reminderMinutes} onChange={(event) => setReminderMinutes(Number(event.target.value))} disabled={!date} /></label>
          <label className="full"><span>子任务</span><textarea value={subtasks} onChange={(event) => setSubtasks(event.target.value)} placeholder={'每行一个子任务\n例如：整理资料'} /></label>
        </div>
        <footer className="modal-actions"><button type="button" className="outline-button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={saving || !title.trim()}>{saving ? '保存中…' : '保存任务'}</button></footer>
      </form>
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

function Topbar({ page, onMenu }: { page: PageKey; onMenu: () => void }) {
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
        <button className="icon-button notification-button" aria-label="通知">
          <Bell size={19} />
          <span />
        </button>
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

function TodayPage({ tasks, habits, projects, quickEntry, setQuickEntry, addTask, toggleTask, toggleHabit }: {
  tasks: Task[]
  habits: Habit[]
  projects: Project[]
  quickEntry: string
  setQuickEntry: (value: string) => void
  addTask: () => void
  toggleTask: (id: number) => void
  toggleHabit: (id: number, day: number) => void
}) {
  const scheduled = tasks.filter((task) => !task.unscheduled)
  const completed = scheduled.filter((task) => task.completed).length
  const progress = Math.round((completed / Math.max(scheduled.length, 1)) * 100)
  const focusMinutes = scheduled.reduce((sum, task) => sum + task.duration, 0)
  const nextTask = scheduled.find((task) => !task.completed)

  return (
    <div className="page-content today-page">
      <section className="page-heading today-heading">
        <div>
          <p className="eyebrow">TODAY</p>
          <h1>把今天过清楚</h1>
          <p>{berlinDate()}，已经完成 {completed} 件事。</p>
        </div>
        <div className="today-progress">
          <strong>{progress}%</strong>
          <span>今日进度</span>
          <ProgressBar value={progress} />
        </div>
      </section>

      <CaptureBar value={quickEntry} onChange={setQuickEntry} onAdd={addTask} />

      <div className="today-layout">
        <div className="today-main">
          <section className="metric-strip" aria-label="今日概览">
            <div><CheckCircle2 size={19} /><span>任务</span><strong>{completed}/{scheduled.length}</strong></div>
            <div><Clock3 size={19} /><span>计划专注</span><strong>{Math.floor(focusMinutes / 60)}h {focusMinutes % 60}m</strong></div>
            <div><TrendingUp size={19} /><span>本周节奏</span><strong>稳定</strong></div>
          </section>

          <section className="content-section timeline-section">
            <div className="section-title-row">
              <div><h2>今日时间轴</h2><span>{scheduled.length} 项安排</span></div>
              <button className="text-button">调整日程 <ChevronRight size={15} /></button>
            </div>
            <div className="timeline">
              {scheduled.map((task) => (
                <article className={`timeline-item ${task.completed ? 'is-complete' : ''}`} key={task.id}>
                  <div className="timeline-time"><strong>{task.start}</strong><span>{task.end}</span></div>
                  <span className="timeline-dot" style={{ borderColor: task.color, backgroundColor: task.completed ? task.color : '#fff' }} />
                  <div className="timeline-task" style={{ '--task-color': task.color } as React.CSSProperties}>
                    <TaskCheck task={task} onToggle={toggleTask} />
                    <div className="task-copy">
                      <strong>{task.title}</strong>
                      <span>{task.project} · {task.duration} 分钟</span>
                    </div>
                    <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}</span>
                    <button className="row-action" aria-label="更多操作"><MoreHorizontal size={18} /></button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="section-title-row">
              <div><h2>今日习惯</h2><span>{habits.filter((habit) => habit.checked[1]).length}/{habits.length} 已完成</span></div>
              <button className="text-button">全部习惯 <ChevronRight size={15} /></button>
            </div>
            <div className="habit-card-grid">
              {habits.map((habit) => (
                <button
                  key={habit.id}
                  type="button"
                  className={`habit-quick-card ${habit.checked[1] ? 'checked' : ''}`}
                  onClick={() => toggleHabit(habit.id, 1)}
                  style={{ '--habit-color': habit.color } as React.CSSProperties}
                >
                  <span className="habit-symbol">{habit.name.includes('训练') ? <Dumbbell size={18} /> : habit.name.includes('睡') ? <Moon size={18} /> : habit.name.includes('阅读') ? <BookOpen size={18} /> : <Sun size={18} />}</span>
                  <span><strong>{habit.name}</strong><small>{habit.detail}</small></span>
                  <span className="habit-checkmark">{habit.checked[1] ? <Check size={15} /> : <Circle size={15} />}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="content-section">
            <div className="section-title-row">
              <div><h2>项目推进</h2><span>按最小下一步行动</span></div>
              <button className="text-button">查看项目 <ChevronRight size={15} /></button>
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
            </div>
          </section>
        </div>

        <aside className="today-aside">
          <section className="aside-section">
            <div className="section-title-row"><h2>接下来</h2><button className="row-action"><MoreHorizontal size={18} /></button></div>
            {nextTask ? <>
              <div className="next-task">
                <span className="next-time">{nextTask.start ?? '待定'}</span>
                <div><strong>{nextTask.title}</strong><span>{nextTask.project} · {nextTask.duration} 分钟</span></div>
              </div>
              <button className="outline-button"><AlarmClock size={16} /> 提前 10 分钟提醒</button>
            </> : <p className="empty-copy">今天的安排已经完成。</p>}
          </section>
          <section className="aside-section inbox-preview">
            <div className="section-title-row"><h2>待安排</h2><span>{tasks.filter((task) => task.unscheduled).length}</span></div>
            {tasks.filter((task) => task.unscheduled).map((task) => (
              <div className="aside-task" key={task.id}>
                <span style={{ backgroundColor: task.color }} />
                <div><strong>{task.title}</strong><small>{task.due}</small></div>
                <button className="row-action"><CalendarDays size={16} /></button>
              </div>
            ))}
          </section>
          <section className="aside-section gentle-note">
            <Sparkles size={18} />
            <div><strong>今日节奏不错</strong><p>完成下一项后，给自己留十分钟缓冲。</p></div>
          </section>
        </aside>
      </div>
    </div>
  )
}

function InboxPage({ tasks, quickEntry, setQuickEntry, addTask, toggleTask, onNewTask }: {
  tasks: Task[]
  quickEntry: string
  setQuickEntry: (value: string) => void
  addTask: () => void
  toggleTask: (id: number) => void
  onNewTask?: () => void
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
          <button className="outline-button compact"><ListFilter size={16} /> 筛选</button>
        </div>
        <div className="task-list">
          {visibleTasks.map((task) => (
            <article className={`task-list-row ${task.completed ? 'is-complete' : ''}`} key={task.id}>
              <TaskCheck task={task} onToggle={toggleTask} />
              <span className="task-color" style={{ backgroundColor: task.color }} />
              <div className="task-list-copy">
                <strong>{task.title}</strong>
                <span>{task.project} · {task.duration} 分钟</span>
              </div>
              <span className={`priority priority-${task.priority}`}>{priorityLabels[task.priority]}优先级</span>
              <span className="task-due"><CalendarDays size={15} />{task.start ? `今天 ${task.start}` : task.due}</span>
              <button className="row-action"><MoreHorizontal size={18} /></button>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function CalendarPage({ tasks, onNewTask }: { tasks: Task[]; onNewTask: () => void }) {
  const [view, setView] = useState<'day' | 'week' | 'month'>('week')
  const dates = currentWeekDates()
  const hours = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00']

  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">CALENDAR</p><h1>日历</h1><p>任务、项目节点和习惯都在同一条时间线上。</p></div>
        <div className="heading-actions"><button className="outline-button compact"><ChevronLeft size={16} /></button><button className="date-button">本周</button><button className="outline-button compact"><ChevronRight size={16} /></button></div>
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
          {Array.from({ length: 35 }, (_, index) => {
            const day = index - 2
            const active = day === new Date().getDate()
            return <div className={`month-day ${active ? 'active' : ''}`} key={index}>{day > 0 && day <= 31 ? <><span>{day}</span>{[4, 7, 12, 18, 25].includes(day) && <i />}</> : null}</div>
          })}
        </section>
      ) : (
        <section className={`week-calendar ${view === 'day' ? 'day-view' : ''}`}>
          <div className="week-head-spacer" />
          {weekDays.map((day, index) => (
            <div className={`week-day-head ${index === 1 ? 'today' : ''}`} key={day}><span>周{day}</span><strong>{dates[index]}</strong></div>
          ))}
          {hours.map((hour, hourIndex) => (
            <div className="calendar-row" key={hour}>
              <span className="hour-label">{hour}</span>
              {weekDays.map((day, dayIndex) => (
                <div className={`calendar-cell ${dayIndex === 1 ? 'today-column' : ''}`} key={`${hour}-${day}`}>
                  {dayIndex === 1 && hourIndex < tasks.filter((task) => !task.unscheduled).length && hourIndex % 2 === 0 && (() => {
                    const task = tasks.filter((item) => !item.unscheduled)[Math.floor(hourIndex / 2)]
                    return <article className="calendar-event" style={{ '--event-color': task.color } as React.CSSProperties}><strong>{task.title}</strong><span>{task.start}–{task.end}</span></article>
                  })()}
                  {dayIndex === 3 && hourIndex === 2 && <article className="calendar-event muted"><strong>项目复盘</strong><span>13:30–14:00</span></article>}
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
  const reachedIndex = Math.max(0, Math.ceil((project.progress / 100) * project.stages.length) - 1)
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
  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">PROJECTS</p><h1>项目</h1><p>一次只推进眼前的下一步。</p></div>
        <button className="primary-button" onClick={onNewProject}><Plus size={17} /> 新建项目</button>
      </section>
      <section className="metric-strip project-metrics">
        <div><FolderKanban size={19} /><span>进行中</span><strong>3</strong></div>
        <div><CheckCircle2 size={19} /><span>本月完成</span><strong>12</strong></div>
        <div><Target size={19} /><span>平均进度</span><strong>47%</strong></div>
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
  const completed = habits.reduce((sum, habit) => sum + habit.checked.filter(Boolean).length, 0)
  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">HABITS</p><h1>习惯</h1><p>稳定比完美更值得庆祝。</p></div>
        <button className="primary-button" onClick={onNewHabit}><Plus size={17} /> 新建习惯</button>
      </section>
      <section className="habit-summary">
        <div><span>本周完成</span><strong>{completed}<small> / {habits.length * 7}</small></strong><ProgressBar value={Math.round((completed / (habits.length * 7)) * 100)} /></div>
        <div><span>最长连续</span><strong>12<small> 天</small></strong><p>晨间拉伸</p></div>
        <div><span>本周状态</span><strong className="steady-text">稳定</strong><p>比上周多完成 3 次</p></div>
      </section>
      <section className="content-section habit-table-section">
        <div className="habit-table-head">
          <span>习惯</span>
          {weekDays.map((day, index) => <span className={index === 1 ? 'today' : ''} key={day}>周{day}<strong>{dates[index]}</strong></span>)}
          <span>连续</span>
        </div>
        {habits.map((habit) => (
          <div className="habit-table-row" key={habit.id}>
            <div className="habit-name"><span style={{ backgroundColor: habit.color }} /><div><strong>{habit.name}</strong><small>{habit.detail}</small></div></div>
            {habit.checked.map((checked, index) => (
              <button
                type="button"
                className={`habit-day ${checked ? 'checked' : ''} ${index === 1 ? 'today' : ''}`}
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
      </section>
      <div className="habit-footer-actions">
        <button className="outline-button"><RotateCcw size={16} /> 补签记录</button>
        <button className="outline-button"><Moon size={16} /> 设置休息日</button>
      </div>
    </div>
  )
}

function ReviewPage({ summary }: { summary: ReviewSummary }) {
  const categories = [
    { label: '工作', value: 78, color: '#496d5b', time: '8h 20m' },
    { label: '学习', value: 64, color: '#b96552', time: '5h 40m' },
    { label: '健康', value: 52, color: '#58748f', time: '4h 10m' },
    { label: '生活', value: 38, color: '#a1843e', time: '2h 25m' },
  ]
  const weekValues = [42, 68, 55, 82, 73, 48, 64]
  const hours = Math.floor(summary.completedMinutes / 60)
  const minutes = summary.completedMinutes % 60
  return (
    <div className="page-content">
      <section className="page-heading">
        <div><p className="eyebrow">REVIEW</p><h1>回顾</h1><p>看见真实的节奏，再决定下一步。</p></div>
        <button className="date-button">本周 <ChevronDown size={15} /></button>
      </section>
      <section className="review-overview">
        <div className="review-score"><span>本周完成率</span><strong>{summary.completionRate}%</strong><p>每一次完成都会记录</p></div>
        <div><CheckCircle2 size={20} /><span>完成任务</span><strong>{summary.completed}</strong><small>共计划 {summary.total} 项</small></div>
        <div><Clock3 size={20} /><span>投入时间</span><strong>{hours}h {minutes}m</strong><small>按已完成任务估算</small></div>
        <div><TimerReset size={20} /><span>逾期任务</span><strong>{summary.overdue}</strong><small>可以随时重新安排</small></div>
      </section>
      <div className="review-grid">
        <section className="content-section chart-section">
          <div className="section-title-row"><div><h2>每日完成情况</h2><span>任务完成率</span></div><TrendingUp size={18} /></div>
          <div className="bar-chart">
            {weekValues.map((value, index) => <div key={index}><span className={index === 1 ? 'today' : ''} style={{ height: `${value}%` }}><i>{value}%</i></span><small>周{weekDays[index]}</small></div>)}
          </div>
        </section>
        <section className="content-section category-section">
          <div className="section-title-row"><div><h2>时间投入</h2><span>按生活领域</span></div></div>
          {categories.map((category) => (
            <div className="category-row" key={category.label}>
              <span className="category-dot" style={{ backgroundColor: category.color }} />
              <strong>{category.label}</strong>
              <ProgressBar value={category.value} color={category.color} />
              <span>{category.time}</span>
            </div>
          ))}
        </section>
      </div>
      <section className="content-section reflection-section">
        <div className="section-title-row"><div><h2>本周回顾</h2><span>留下一点对自己的观察</span></div><button className="text-button">编辑</button></div>
        <div className="reflection-grid">
          <div><strong>做得不错</strong><p>学习任务集中到上午后，完成率明显提高。三次训练都按计划完成。</p></div>
          <div><strong>下周调整</strong><p>周三安排过满，晚间任务容易拖延。为临时事项预留两个空档。</p></div>
          <div><strong>继续保持</strong><p>每天只确定三件重要事项，减少频繁切换带来的消耗。</p></div>
        </div>
      </section>
    </div>
  )
}

function SettingsPage({ settings: initialSettings, onSave, onTestMail, onLogout }: {
  settings: UserSettings
  onSave: (settings: UserSettings) => Promise<void>
  onTestMail: () => Promise<void>
  onLogout: () => Promise<void>
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [testingMail, setTestingMail] = useState(false)

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
  return (
    <div className="page-content settings-page">
      <section className="page-heading"><div><p className="eyebrow">SETTINGS</p><h1>设置</h1><p>让看板按照你的生活节奏工作。</p></div></section>
      <div className="settings-layout">
        <nav className="settings-nav">
          <button className="active"><User size={17} />账户</button>
          <button><Bell size={17} />提醒</button>
          <button><CalendarRange size={17} />日程</button>
          <button><Archive size={17} />数据</button>
        </nav>
        <div className="settings-main">
          <section className="settings-section">
            <div className="settings-title"><div><ShieldCheck size={19} /><div><h2>账户与安全</h2><p>单用户账户</p></div></div></div>
            <div className="form-grid">
              <label><span>显示名称</span><input value={settings.displayName} onChange={(event) => setSettings({ ...settings, displayName: event.target.value })} /></label>
              <label><span>登录用户名</span><input value="sakura" disabled /></label>
              <label className="full"><span>邮箱地址</span><div className="field-with-icon"><Mail size={17} /><input value={settings.email} onChange={(event) => setSettings({ ...settings, email: event.target.value })} type="email" /></div></label>
            </div>
            <button className="outline-button"><LockKeyhole size={16} /> 修改密码</button>
          </section>
          <section className="settings-section">
            <div className="settings-title"><div><Bell size={19} /><div><h2>邮件提醒</h2><p>提醒将按照柏林时间发送</p></div></div></div>
            <div className="setting-row"><div><strong>任务开始前提醒</strong><span>默认提前 {settings.taskReminderMinutes} 分钟</span></div><Toggle checked={settings.emailReminders} onChange={() => setSettings({ ...settings, emailReminders: !settings.emailReminders })} /></div>
            <div className="setting-row"><div><strong>每日收尾邮件</strong><span>每天 {settings.dailySummaryTime.slice(0, 5)} 汇总进度</span></div><Toggle checked={settings.dailySummary} onChange={() => setSettings({ ...settings, dailySummary: !settings.dailySummary })} /></div>
            <div className="setting-row"><div><strong>逾期任务提醒</strong><span>每天上午发送一次</span></div><Toggle checked={settings.overdueReminder} onChange={() => setSettings({ ...settings, overdueReminder: !settings.overdueReminder })} /></div>
            <button className="outline-button" onClick={testMail} disabled={testingMail}><Mail size={16} /> {testingMail ? '发送中…' : '发送测试邮件'}</button>
          </section>
          <section className="settings-section">
            <div className="settings-title"><div><CalendarRange size={19} /><div><h2>日期与时间</h2><p>日程和提醒的默认规则</p></div></div></div>
            <div className="form-grid">
              <label><span>时区</span><select value={settings.timezone} onChange={(event) => setSettings({ ...settings, timezone: event.target.value })}><option value="Europe/Berlin">Europe/Berlin</option><option value="Asia/Shanghai">Asia/Shanghai</option></select></label>
              <label><span>一周开始于</span><select value={settings.weekStartsOn} onChange={(event) => setSettings({ ...settings, weekStartsOn: event.target.value as 'monday' | 'sunday' })}><option value="monday">星期一</option><option value="sunday">星期日</option></select></label>
              <label><span>任务默认提前提醒</span><input type="number" min="0" max="10080" value={settings.taskReminderMinutes} onChange={(event) => setSettings({ ...settings, taskReminderMinutes: Number(event.target.value) })} /></label>
              <label><span>每日收尾时间</span><input type="time" value={settings.dailySummaryTime.slice(0, 5)} onChange={(event) => setSettings({ ...settings, dailySummaryTime: `${event.target.value}:00` })} /></label>
            </div>
          </section>
          <div className="settings-actions"><button className="primary-button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存设置'}</button><button className="danger-button" onClick={onLogout}><LogOut size={16} /> 退出登录</button></div>
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
  const [page, setPage] = useState<PageKey>('today')
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
  const [settings, setSettings] = useState(defaultSettings)
  const [review, setReview] = useState(defaultReview)
  const [editor, setEditor] = useState<'task' | 'project' | 'habit' | null>(null)
  const [quickEntry, setQuickEntry] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [toast, setToast] = useState('')

  const inboxCount = useMemo(() => tasks.filter((task) => !task.completed && task.unscheduled).length, [tasks])

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
    setSettings(data.settings)
    setReview(data.review)
  }

  function showToast(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
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
        const updated = await api.updateTask({ id, completed })
        setTasks((current) => current.map((item) => item.id === id ? updated : item))
      } catch (error) {
        setTasks((current) => current.map((item) => item.id === id ? task : item))
        showToast(error instanceof Error ? error.message : '任务状态保存失败')
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
    await api.testMail()
    showToast('测试邮件已发送')
  }

  async function saveTask(draft: TaskDraft) {
    if (!demoMode) {
      const created = await api.createTask(draft)
      setTasks((current) => [created, ...current])
      showToast('任务已创建')
      return
    }

    const category = categories.find((item) => item.id === draft.categoryId)
    const project = projectItems.find((item) => item.id === draft.projectId)
    const created: Task = {
      id: Date.now(),
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
      completed: false,
      unscheduled: !draft.startAt,
      recurrenceRule: draft.recurrenceRule,
      reminderMinutes: draft.reminderMinutes,
    }
    setTasks((current) => [created, ...current])
    showToast('任务已创建')
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
    setPage(next)
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
        <Topbar page={page} onMenu={() => setMenuOpen(true)} />
        {page === 'today' && <TodayPage tasks={tasks} habits={habits} projects={projectItems} quickEntry={quickEntry} setQuickEntry={setQuickEntry} addTask={addTask} toggleTask={toggleTask} toggleHabit={toggleHabit} />}
        {page === 'inbox' && <InboxPage tasks={tasks} quickEntry={quickEntry} setQuickEntry={setQuickEntry} addTask={addTask} toggleTask={toggleTask} onNewTask={() => setEditor('task')} />}
        {page === 'calendar' && <CalendarPage tasks={tasks} onNewTask={() => setEditor('task')} />}
        {page === 'projects' && <ProjectsPage projects={projectItems} onNewProject={() => setEditor('project')} />}
        {page === 'habits' && <HabitsPage habits={habits} toggleHabit={toggleHabit} onNewHabit={() => setEditor('habit')} />}
        {page === 'review' && <ReviewPage summary={review} />}
        {page === 'settings' && <SettingsPage settings={settings} onSave={saveSettings} onTestMail={testMail} onLogout={logout} />}
      </div>
      <MobileNav page={page} setPage={navigate} />
      {editor === 'task' && <TaskEditor projects={projectItems} categories={categories} defaultReminderMinutes={settings.taskReminderMinutes} onClose={() => setEditor(null)} onSave={saveTask} />}
      {editor === 'project' && <ProjectEditor onClose={() => setEditor(null)} onSave={saveProject} />}
      {editor === 'habit' && <HabitEditor onClose={() => setEditor(null)} onSave={saveHabit} />}
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  )
}
