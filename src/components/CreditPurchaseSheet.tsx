import { ExternalLink, WalletCards } from 'lucide-react'
import { KIE_CREDITS_URL } from '../lib/kie.ts'
import { Pressable } from './motion/Pressable.tsx'
import { SpringSheet } from './motion/SpringSheet.tsx'

export function CreditPurchaseSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <SpringSheet
      open={open}
      onClose={onClose}
      labelledBy="credit-purchase-title"
      maxWidthClass="max-w-md"
    >
      <div className="px-5 pt-4 pb-5 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--warning)]/10 text-[var(--warning)]">
            <WalletCards size={20} strokeWidth={2} aria-hidden />
          </span>
          <div>
            <h2 id="credit-purchase-title" className="text-lg font-bold">
              Not enough credits
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              Buy credits on kie.ai, then generate again.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Pressable onClick={onClose} className="studio-btn" scaleTo={0.96}>
            Close
          </Pressable>
          <a
            href={KIE_CREDITS_URL}
            target="_blank"
            rel="noreferrer"
            data-sheet-initial-focus="true"
            className="studio-btn-primary w-auto gap-1 px-4 text-sm"
          >
            Buy credits
            <ExternalLink size={14} strokeWidth={2} aria-hidden />
          </a>
        </div>
      </div>
    </SpringSheet>
  )
}
