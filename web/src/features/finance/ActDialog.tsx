import { useEffect, useMemo, useState } from "react"
import { Download } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { useAppStore } from "@/store/useAppStore"
import { fmtMoney, pluralizeRu } from "@/lib/money"
import { actOrders, actTotals, actFilename, monthLabel } from "@/lib/act"
import { alertDialog } from "@/store/useDialogStore"

/**
 * Акт за месяц: заказчик, месяц, что войдёт — и файл .xlsx, который можно
 * отправить как есть. Раньше это собиралось руками из таблицы Финансов.
 */
export function ActDialog({ open, onOpenChange, initialClient }: { open: boolean; onOpenChange: (open: boolean) => void; initialClient?: string }) {
  const orders = useAppStore((s) => s.orders)
  const email = useAppStore((s) => s.cloudUserEmail)

  const clients = useMemo(
    () => [...new Set(orders.filter((o) => o.status !== "cancelled").map((o) => o.client).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru")),
    [orders]
  )
  const months = useMemo(() => {
    const now = new Date()
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      return { value: `${d.getFullYear()}-${d.getMonth()}`, label: monthLabel(d.getFullYear(), d.getMonth()) }
    })
  }, [])

  const [client, setClient] = useState("")
  const [month, setMonth] = useState(months[0].value)
  const [onlyDone, setOnlyDone] = useState(true)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    if (!open) return
    setClient(initialClient || clients[0] || "")
    setMonth(months[0].value)
    setOnlyDone(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialClient])

  const [year, month0] = month.split("-").map(Number)
  const included = useMemo(() => actOrders(orders, client, year, month0, { onlyDone }), [orders, client, year, month0, onlyDone])
  const totals = actTotals(included)

  async function download() {
    if (!included.length) return
    setExporting(true)
    try {
      const [ExcelJS, { buildActWorkbook }] = await Promise.all([import("exceljs"), import("@/lib/actExcel")])
      const buffer = await buildActWorkbook(ExcelJS.default ?? ExcelJS, {
        client, year, month0, orders: included, performer: email || undefined,
      })
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = actFilename(client, year, month0)
      a.click()
      URL.revokeObjectURL(url)
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      await alertDialog({ title: "Не удалось собрать акт", body: err instanceof Error ? err.message : String(err) })
    } finally {
      setExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Акт за месяц</DialogTitle>
          <DialogDescription>Список сданных уроков с составом и суммами, итоги по авансу и оплате — файлом Excel для заказчика.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Заказчик</Label>
              <Select value={client} onValueChange={setClient}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Выберите" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-2xs font-bold tracking-wide text-muted-foreground uppercase">Месяц</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={onlyDone} onCheckedChange={(c) => setOnlyDone(!!c)} />
            Только сданные (статус «Завершён»)
          </label>
          <div className="rounded-lg bg-muted px-3.5 py-3 text-sm">
            {included.length === 0 ? (
              <span className="text-muted-foreground">За этот месяц у заказчика нет {onlyDone ? "сданных " : ""}уроков — акт будет пустым.</span>
            ) : (
              <div className="flex flex-col gap-1">
                <div><b>{included.length}</b> {pluralizeRu(included.length, "урок", "урока", "уроков")} на <b>{fmtMoney(totals.total)}</b></div>
                <div className="text-muted-foreground">Закрыто авансом {fmtMoney(totals.advance)} · оплачено {fmtMoney(totals.paid)} · к доплате <b className="text-foreground">{fmtMoney(totals.remaining)}</b></div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button>
          <Button type="button" disabled={!included.length || exporting} onClick={download} className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
            <Download />
            {exporting ? "Собираю..." : "Скачать .xlsx"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
