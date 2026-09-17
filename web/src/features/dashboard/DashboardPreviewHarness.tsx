import { useEffect } from "react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/store/useAppStore"
import { dateKey } from "@/lib/money"
import { AppShell } from "@/components/layout/AppShell"
import { TodayPage } from "@/features/today/TodayPage"
import { OrdersPage } from "@/features/orders/OrdersPage"
import { TimelinePage } from "@/features/timeline/TimelinePage"
import { TasksPage } from "@/features/tasks/TasksPage"
import { FinancePage } from "@/features/finance/FinancePage"
import { ClientsPage } from "@/features/clients/ClientsPage"
import { PlanningPage } from "@/features/planning/PlanningPage"
import { SettingsPage } from "@/features/settings/SettingsPage"
import type { Order, Task, Advance, PlanningBoard, ActivityLogEntry } from "@/types/models"

// Классы и предметы намеренно разные и «неудобные»: с однобуквенными литерами,
// с двузначным номером и без номера вовсе. На одинаковых данных превью не
// показывало ни группировки, ни порядка сортировки — а именно ради этого
// харнесс и открывают.
const PREVIEW_GRADES = ["9А", "5 класс", "10 класс", "9Б", "Без класса", "7 класс", "11 класс"]
const PREVIEW_SUBJECTS = ["Литература", "Математика", "Русский язык", "Дизайн"]

function fakeOrder(daysOffset: number, total: number, status: Order["status"] = "progress", client = "Иванова Мария Петровна"): Order {
  const start = dateKey(new Date(Date.now() + daysOffset * 86400000))
  const deadline = dateKey(new Date(Date.now() + (daysOffset + 3) * 86400000))
  const spread = Math.abs(daysOffset)
  return {
    id: "preview_o" + daysOffset + client,
    title: "",
    client,
    subject: PREVIEW_SUBJECTS[spread % PREVIEW_SUBJECTS.length],
    grade: PREVIEW_GRADES[spread % PREVIEW_GRADES.length],
    quarter: "1",
    lesson: String(Math.abs(daysOffset) + 1),
    status,
    isPaid: status === "done",
    priority: daysOffset === 0,
    advanceUsed: 0,
    advanceAllocations: [],
    payments: status === "done" ? [{ id: "p" + daysOffset, amount: total, date: deadline, note: "" }] : [],
    paidAmount: status === "done" ? total : 0,
    taxType: "none",
    start,
    deadline,
    estimatedHours: "6",
    actualHours: "5",
    lines: [
      { id: "l1_" + daysOffset, label: "Презентация", type: "Слайд", qty: 12, pomoHours: 2, rate: total / 3 / 12, ignorePrice: false, ready: true },
      { id: "l2_" + daysOffset, label: "Рабочий лист", type: "Страница", qty: 4, pomoHours: 1, rate: total / 3 / 4, ignorePrice: false, ready: false },
      { id: "l3_" + daysOffset, label: "Конспект", type: "Страница", qty: 4, pomoHours: 1, rate: total / 3 / 4, ignorePrice: false, ready: false },
    ],
    notes: "",
    createdAt: Date.now(),
    linkedLessonId: null,
    paidAt: status === "done" ? deadline : null,
  }
}

function fakeTasks(): Task[] {
  return [
    { id: "t1", text: "Проверить домашние задания у 9А", time: "10:00", done: false, period: "today", createdAt: dateKey(new Date()) },
    { id: "t2", text: "Подготовить материалы к уроку", time: "14:30", done: false, period: "today", createdAt: dateKey(new Date()) },
    { id: "t5", text: "6кл лит https://drive.google.com/drive/folders/1UiJAYbhAE339uQFBnvffhAwiDjyFRBri", time: "", done: false, period: "today", createdAt: dateKey(new Date(Date.now() - 3 * 86400000)) },
    { id: "t3", text: "Позвонить клиенту по оплате", time: "", done: true, period: "today", createdAt: dateKey(new Date()) },
    { id: "t4", text: "Задача на неделю", time: "", done: false, period: "week", createdAt: dateKey(new Date()) },
  ]
}

function fakeAdvances(): Advance[] {
  return Array.from({ length: 14 }, (_, i) => ({
    id: "a" + i,
    client: "Клиент " + (i + 1),
    amount: 5000 + i * 1000,
    date: dateKey(new Date(Date.now() - i * 86400000)),
    note: i % 3 === 0 ? "Предоплата" : "",
  }))
}

function fakeBoard(): PlanningBoard {
  return {
    id: "pb1",
    subject: "Математика",
    title: "9А",
    quarter: "1 четверть",
    deadline: "",
    baseTemplate: ["Презентация", "Рабочий лист"],
    collapsed: false,
    archived: false,
    lessons: Array.from({ length: 8 }, (_, i) => ({
      id: "pl_" + i,
      num: i + 1,
      title: `Урок ${i + 1}`,
      color: i % 3 === 0 ? "green-3" : "gray",
      items: [{ id: "it" + i, text: "Презентация", done: i % 2 === 0 }],
      colorLocked: false,
      orderLinked: false,
      notes: "",
    })),
  }
}

// Журнал в «старом» формате — как его писали прежние версии: по строке на
// минуту таймера и пара «+30, −30» от опечатки. Нужен, чтобы видеть в
// превью вкладку «Журнал часов» со схлопыванием и сверкой.
function fakeActivityLog(orders: Order[]): ActivityLogEntry[] {
  const log: ActivityLogEntry[] = []
  const day = (offset: number) => dateKey(new Date(Date.now() - offset * 86400000))
  for (let i = 0; i < 40; i++) log.push({ date: day(1), orderId: orders[0].id, field: "hours", delta: 1 / 60, entryId: "m" + i })
  log.push({ date: day(1), orderId: orders[1].id, field: "hours", delta: 30, entryId: "p1" })
  log.push({ date: day(1), orderId: orders[1].id, field: "hours", delta: -30, entryId: "p2" })
  log.push({ date: day(2), orderId: orders[1].id, field: "hours", delta: 2.5, entryId: "p3" })
  log.push({ date: day(3), orderId: orders[2].id, field: "hours", delta: 4, entryId: "p4" })
  log.push({ date: day(5), orderId: "deleted_order", field: "hours", delta: 1.25, entryId: "p5" })
  return log
}

export function DashboardPreviewHarness() {
  useEffect(() => {
    const orders = Array.from({ length: 16 }, (_, i) =>
      fakeOrder(i - 5, 15000 + i * 1500, i % 6 === 0 ? "done" : "progress", "Клиент " + (i + 1))
    )
    // График доски: 2 урока в неделю, старт три недели назад — чтобы в превью
    // было видно и текущую неделю, и отставание.
    const start = dateKey(new Date(Date.now() - 21 * 86400000))
    useAppStore.setState({
      orders,
      activityLog: fakeActivityLog(orders),
      tasks: fakeTasks(),
      advances: fakeAdvances(),
      planningBoards: [fakeBoard()],
      appSettings: {
        ...useAppStore.getState().appSettings,
        boardSchedules: { pb1: { start, perWeek: 2, exceptions: { "2": 0 } } },
        boardLinks: { pb1: "https://drive.google.com/drive/folders/preview" },
      },
      dataLoaded: true,
      cloudUserEmail: "preview@example.com",
      schemaIssue: "entry_id",
    })
  }, [])

  return (
    <TooltipProvider delayDuration={200}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<TodayPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:orderId" element={<OrdersPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="clients/:client" element={<ClientsPage />} />
            <Route path="planning" element={<PlanningPage />} />
            <Route path="planning/:boardId/:lessonId" element={<PlanningPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>
  )
}
