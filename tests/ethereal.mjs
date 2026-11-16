// nodemailer.createTestAccount() caches one account per process; tests that need
// several distinct mailboxes ask the Ethereal API directly.
export async function freshEtherealAccount() {
  const res = await fetch('https://api.nodemailer.com/user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestor: 'mailbox-e2e', version: '1' })
  })
  const data = await res.json()
  if (data.status !== 'success') throw new Error(data.error ?? 'Ethereal account request failed')
  return data
}
