export type OrderStatus = "queue" | "progress" | "review" | "done" | "cancelled"
export type TaxType = "none" | "individual" | "entity"
export type TaskPeriod = "today" | "week" | "month" | "year"

export interface OrderLine {
  id: string
  label: string
  type: string
  qty: number
  pomoHours: number
  rate: number
  ignorePrice: boolean
  ready: boolean
}

export interface Payment {
  id: string
  amount: number
  date: string
  note: string
}

/**
 * Списание аванса с привязкой к конкретному поступлению. Сумма списаний не
 * больше advanceUsed; разница (advanceUsed − Σ allocations) — старые заказы,
 * где списание было только числом по клиенту, без привязки к авансу.
 */
export interface AdvanceAllocation {
  advanceId: string
  amount: number
}

export interface Order {
  id: string
  title: string
  client: string
  subject: string
  grade: string
  quarter: string
  lesson: string
  status: OrderStatus
  isPaid: boolean
  priority: boolean
  /** Итого списано аванса на заказ — источник истины для денег. */
  advanceUsed: number
  /** Из каких именно авансов (см. AdvanceAllocation). Может быть пустым у старых заказов. */
  advanceAllocations: AdvanceAllocation[]
  payments: Payment[]
  paidAmount: number
  taxType: TaxType
  start: string
  deadline: string
  estimatedHours: string | number
  actualHours: string | number
  lines: OrderLine[]
  notes: string
  createdAt: number
  linkedLessonId: string | null
  paidAt: string | null
}

export interface Task {
  id: string
  text: string
  time: string
  done: boolean
  period: TaskPeriod
  createdAt: string
}

export interface Advance {
  id: string
  client: string
  amount: number
  date: string
  note: string
}

export interface PlanningLessonItem {
  id: string
  text: string
  done: boolean
  fromOrder?: boolean
}

export interface PlanningLesson {
  id: string
  num: number
  title: string
  color: string
  items: PlanningLessonItem[]
  colorLocked: boolean
  orderLinked: boolean
  notes: string
}

export interface PlanningBoard {
  id: string
  subject: string
  title: string
  quarter: string
  deadline: string
  baseTemplate: string[]
  collapsed: boolean
  archived: boolean
  lessons: PlanningLesson[]
}

export interface DashboardMetric {
  id: string
  type: string
  goal: number
  secondaryGoal?: number
  hidden?: boolean
}

export interface HiddenEntries {
  clients: string[]
  types: string[]
  units: string[]
  subjects: string[]
  classes: string[]
}

export interface OrderTemplateLine {
  label: string
  type: string
  qty: number
  rate: number
}

export interface OrderTemplate {
  id: string
  name: string
  lines: OrderTemplateLine[]
}

export interface AppSettings {
  clients: string[]
  types: string[]
  units: string[]
  subjects: string[]
  classes: string[]
  hiddenEntries: HiddenEntries
  dashboardMetrics: DashboardMetric[]
  orderTemplates: OrderTemplate[]
  /**
   * Шаблон заказа доски планирования: те же пункты, что в baseTemplate доски,
   * но с единицей, количеством и ставкой. По нему заказ из урока создаётся с
   * ценами в один клик. Ключ — id доски. Лежит в настройках, а не в самой
   * доске, чтобы не менять схему таблицы planning_boards.
   */
  boardTemplates: Record<string, OrderTemplateLine[]>
  /** График класса: уроков в неделю и дата старта (lib/boardSchedule.ts). Ключ — id доски. */
  boardSchedules: Record<string, { start: string; perWeek: number }>
  /** Ссылка на материалы класса (папка на диске). Ключ — id доски. */
  boardLinks: Record<string, string>
}

export interface ActivityLogEntry {
  date: string
  orderId: string
  field: "hours"
  delta: number
  entryId?: string
}

export interface BackupSettings {
  enabled: boolean
  interval: "change" | "1h" | "6h" | "24h" | "7d"
  path: string
  lastBackup: number
  // user_id аккаунтов, которые НЕ надо бэкапить автоматически (например
  // тестовый). Пусто/undefined — бэкапятся все известные аккаунты.
  excludedAccounts?: string[]
}
