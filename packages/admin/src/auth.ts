export function getAdminToken() {
  return localStorage.getItem('adminToken') || ''
}

export function setAdminToken(token: string) {
  localStorage.setItem('adminToken', token)
  window.dispatchEvent(new Event('admin-auth-changed'))
}

export function clearAdminToken() {
  localStorage.removeItem('adminToken')
  localStorage.removeItem('adminSessionId')
  window.dispatchEvent(new Event('admin-auth-changed'))
}

export function getAdminSessionId() {
  return localStorage.getItem('adminSessionId') || ''
}

export function setAdminSessionId(sessionId: string) {
  if (sessionId) localStorage.setItem('adminSessionId', sessionId)
  else localStorage.removeItem('adminSessionId')
}
