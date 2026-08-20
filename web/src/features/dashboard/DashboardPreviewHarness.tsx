import { useEffect } from "react"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useAppStore } from "@/store/useAppStore"
import { dateKey } from "@/lib/money"
import { AppShell } from "@/components/layout/AppShell"
import { DashboardPage } from "./DashboardPage"
import { OrdersPage } from "@/features/orders/OrdersPage"
import { TimelinePage } from "@/features/timeline/TimelinePage"
import { TasksPage } from "@/features/tasks/TasksPage"
import { FinancePage } from "@/features/finance/FinancePage"
import { ClientsPage } from "@/features/clients/ClientsPage"
import { PlanningPage } from "@/features/planning/PlanningPage"
import { SettingsPage } from "@/features/settings/SettingsPage"
import type { Order, Task, Advance, PlanningBoard } from "@/types/models"

function fakeOrder(daysOffset: number, total: number, status: Order["status"] = "progress", client = "Иванова Мария Петровна"): Order {
  const start = dateKey(new Date(Date.now() + daysOffset * 86400000))
  const deadline = dateKey(new Date(Date.now() + (daysOffset + 3) * 86400000))
  return {
    id: "preview_o" + daysOffset + client,
    title: "",
    client,
    subject: "Литература",
    grade: "9А",
    quarter: "1",
    lesson: String(Math.abs(daysOffset) + 1),
    status,
    isPaid: status === "done",
    priority: daysOffset === 0,
    advanceUsed: 0,
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

export function DashboardPreviewHarness() {
  useEffect(() => {
    useAppStore.setState({
      orders: [
        ...Array.from({ length: 16 }, (_, i) =>
          fakeOrder(i - 5, 15000 + i * 1500, i % 6 === 0 ? "done" : "progress", "Клиент " + (i + 1))
        ),
      ],
      tasks: fakeTasks(),
      advances: fakeAdvances(),
      planningBoards: [fakeBoard()],
      dataLoaded: true,
      cloudUserEmail: "preview@example.com",
    })
  }, [])

  return (
    <TooltipProvider delayDuration={200}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="planning" element={<PlanningPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </TooltipProvider>
  )
}
