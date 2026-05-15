export function getAdminToken() {
  return localStorage.getItem('adminToken') || ''
}

export function setAdminToken(token: string) {
  localStorage.setItem('adminToken', token)
  window.dispatchEvent(new Event('admin-auth-changed'))
}

export function clearAdminToken() {
  localStorage.removeItem('adminToken')
  window.dispatchEvent(new Event('admin-auth-changed'))
}

