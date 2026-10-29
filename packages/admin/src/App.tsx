import './App.css'
import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './layout/AdminLayout'
import { LoginPage } from './pages/LoginPage'
import { HomePage } from './pages/HomePage'
import { WorkbenchPage } from './pages/WorkbenchPage'
import { OrdersPage } from './pages/OrdersPage'
import { ContractsPage } from './pages/ContractsPage'
import { TenantProfilesPage } from './pages/TenantProfilesPage'
import { HousesPage } from './pages/HousesPage'
import { BillsPage } from './pages/BillsPage'
import { OverduePage } from './pages/OverduePage'
import { TransactionsPage } from './pages/TransactionsPage'
import { ContractPrepaymentsPage } from './pages/ContractPrepaymentsPage'
import { RentRemindersPage } from './pages/RentRemindersPage'
import { ReportsPage } from './pages/ReportsPage'
import { SystemDepartmentsPage } from './pages/SystemDepartmentsPage'
import { SystemRolesPage } from './pages/SystemRolesPage'
import { SystemUsersPage } from './pages/SystemUsersPage'
import { ProfilePage } from './pages/ProfilePage'
import { SubletsPage } from './pages/SubletsPage'
import { BrokersPage } from './pages/BrokersPage'
import { SubMerchantsPage } from './pages/SubMerchantsPage'
import { HandoverTemplatesPage } from './pages/HandoverTemplatesPage'
import { ReprintApprovalsPage } from './pages/ReprintApprovalsPage'
import { HousingHousesPage } from './pages/HousingHousesPage'
import { TemporaryCollectionsPage } from './pages/TemporaryCollectionsPage'
import { getAdminToken } from './auth'

function RetiredLedgerPage() {
  return <div className="a-card"><div className="a-h1">记账本已停用</div><p className="a-muted">本次后台原型不再提供记账本功能。</p></div>
}

function App() {
  const [authed, setAuthed] = useState(() => Boolean(getAdminToken()))

  useEffect(() => {
    const onChanged = () => setAuthed(Boolean(getAdminToken()))
    window.addEventListener('admin-auth-changed', onChanged)
    window.addEventListener('storage', onChanged)
    return () => {
      window.removeEventListener('admin-auth-changed', onChanged)
      window.removeEventListener('storage', onChanged)
    }
  }, [])

  return (
    <AdminLayout>
      <Routes>
        {/* 未登录只能看登录页；已登录时访问 /login 会跳回首页 */}
        <Route path="/login" element={authed ? <Navigate to="/" replace /> : <LoginPage />} />

        {/* 登录后才能访问以下页面，否则一律跳到登录页 */}
        <Route path="/" element={authed ? <HomePage /> : <Navigate to="/login" replace />} />
        <Route path="/workbench" element={authed ? <WorkbenchPage /> : <Navigate to="/login" replace />} />
        <Route path="/workbench/index" element={authed ? <Navigate to="/workbench" replace /> : <Navigate to="/login" replace />} />
        <Route path="/houses" element={authed ? <HousesPage /> : <Navigate to="/login" replace />} />
        <Route path="/orders" element={authed ? <OrdersPage /> : <Navigate to="/login" replace />} />
        <Route path="/contracts" element={authed ? <ContractsPage /> : <Navigate to="/login" replace />} />
        <Route path="/sublets" element={authed ? <SubletsPage /> : <Navigate to="/login" replace />} />
        <Route path="/tenant-profiles" element={authed ? <TenantProfilesPage /> : <Navigate to="/login" replace />} />
        <Route path="/transactions" element={authed ? <TransactionsPage /> : <Navigate to="/login" replace />} />
        <Route path="/contract-prepayments" element={authed ? <ContractPrepaymentsPage /> : <Navigate to="/login" replace />} />
        <Route path="/bills" element={authed ? <BillsPage /> : <Navigate to="/login" replace />} />
        <Route
          path="/bill-verifications"
          element={authed ? <Navigate to="/transactions" replace /> : <Navigate to="/login" replace />}
        />
        <Route path="/overdue" element={authed ? <OverduePage /> : <Navigate to="/login" replace />} />
        <Route path="/rent-reminders" element={authed ? <RentRemindersPage /> : <Navigate to="/login" replace />} />
        <Route path="/reports" element={authed ? <ReportsPage /> : <Navigate to="/login" replace />} />
        <Route path="/brokers" element={authed ? <BrokersPage /> : <Navigate to="/login" replace />} />
        <Route path="/sub-merchants" element={authed ? <SubMerchantsPage /> : <Navigate to="/login" replace />} />
        <Route path="/handover-templates" element={authed ? <HandoverTemplatesPage /> : <Navigate to="/login" replace />} />
        <Route path="/reprint-approvals" element={authed ? <ReprintApprovalsPage /> : <Navigate to="/login" replace />} />
        <Route path="/housing-houses" element={authed ? <HousingHousesPage /> : <Navigate to="/login" replace />} />
        <Route path="/temporary-collections" element={authed ? <TemporaryCollectionsPage /> : <Navigate to="/login" replace />} />
        <Route path="/ledger-book" element={authed ? <RetiredLedgerPage /> : <Navigate to="/login" replace />} />

        <Route path="/system/departments" element={authed ? <SystemDepartmentsPage /> : <Navigate to="/login" replace />} />
        <Route path="/system/roles" element={authed ? <SystemRolesPage /> : <Navigate to="/login" replace />} />
        <Route path="/system/users" element={authed ? <SystemUsersPage /> : <Navigate to="/login" replace />} />
        <Route path="/me" element={authed ? <ProfilePage /> : <Navigate to="/login" replace />} />

        <Route path="*" element={<Navigate to={authed ? '/' : '/login'} replace />} />
      </Routes>
    </AdminLayout>
  )
}

export default App
