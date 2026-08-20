import { PageHeader } from "@/components/layout/AppShell"
import { TaskListWidget } from "./TaskListWidget"

export function TasksPage() {
  return (
    <div>
      <PageHeader title="Задачи" subtitle="Операционный список дел с разбивкой по временным периодам" />
      <TaskListWidget />
    </div>
  )
}
