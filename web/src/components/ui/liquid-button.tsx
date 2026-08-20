import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const liquidButtonVariants = cva(
  "liquid-button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-bold whitespace-nowrap text-white outline-none select-none focus-visible:ring-3 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      size: {
        default: "h-9 px-5 text-sm",
        sm: "h-8 px-4 text-[13px]",
        lg: "h-10 px-6 text-[15px]",
        xl: "h-12 px-8 text-base",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function LiquidButton({
  className,
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof liquidButtonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="liquid-button"
      className={cn(liquidButtonVariants({ size, className }))}
      {...props}
    />
  )
}

export { LiquidButton, liquidButtonVariants }
