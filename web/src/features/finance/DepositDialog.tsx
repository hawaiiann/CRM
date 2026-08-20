import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAppStore } from "@/store/useAppStore"
import { saveData } from "@/lib/cloudSync"
import { parseNum, dateKey } from "@/lib/money"
import type { Advance } from "@/types/models"

function randId() {
  return "adv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

export function DepositDialog({
  open,
  onOpenChange,
  initialClient,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialClient?: string
}) {
  const appSettings = useAppStore((s) => s.appSettings)
  const setAdvances = useAppStore((s) => s.setAdvances)
  const [client, setClient] = useState(initialClient || "")
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(dateKey(new Date()))
  const [note, setNote] = useState("")

  useEffect(() => {
    if (open) setClient(initialClient || "")
  }, [open, initialClient])

  function reset() {
    setClient("")
    setAmount("")
    setDate(dateKey(new Date()))
    setNote("")
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseNum(amount)
    if (!client.trim() || !amt) return
    const a: Advance = { id: randId(), client: client.trim(), amount: amt, date, note: note.trim() }
    setAdvances((prev) => [...prev, a])
    saveData()
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v) }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Внести аванс от клиента</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Заказчик / клиент</Label>
            <Input list="deposit-clients-list" value={client} onChange={(e) => setClient(e.target.value)} required placeholder="Выберите или впишите клиента..." />
            <datalist id="deposit-clients-list">{appSettings.clients.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Сумма аванса (₽)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required placeholder="50 000 ₽" />
            </div>
            <div>
              <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Дата поступления</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 block text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Примечание / комментарий</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: Предоплата за август" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" className="bg-cta/90 font-extrabold text-cta-foreground hover:bg-cta">
              Внести аванс
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
