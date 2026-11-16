import type { MailboxApi } from '../shared/types'

declare global {
  interface Window {
    mailbox: MailboxApi
  }
}
