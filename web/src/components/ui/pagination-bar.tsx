import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

export function PaginationBar({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [5, 10, 20],
}: {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  pageSizeOptions?: number[]
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const currentPage = Math.min(page, totalPages - 1)

  return (
    <div className="flex flex-wrap items-center justify-start gap-x-5.5 gap-y-2.5 sm:justify-end">
      <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span>Строк на странице</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger size="sm" className="w-[68px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {pageSizeOptions.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="text-[12.5px] font-bold">Страница {currentPage + 1} из {totalPages}</div>
      <div className="flex gap-1.5">
        <Button variant="outline" size="icon-sm" disabled={currentPage === 0} onClick={() => onPageChange(0)}>
          <ChevronsLeft />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={currentPage === 0} onClick={() => onPageChange(Math.max(0, currentPage - 1))}>
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={currentPage >= totalPages - 1} onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}>
          <ChevronRight />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={currentPage >= totalPages - 1} onClick={() => onPageChange(totalPages - 1)}>
          <ChevronsRight />
        </Button>
      </div>
    </div>
  )
}
