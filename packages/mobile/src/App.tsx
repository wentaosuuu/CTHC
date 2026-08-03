import './App.css'
import { Navigate, Route, Routes } from 'react-router-dom'
import { MobileLayout } from './layout/MobileLayout'
import { HouseListPage } from './pages/HouseListPage'
import { HouseDetailPage } from './pages/HouseDetailPage'
import { MapPage } from './pages/MapPage'
import { OrderCreatePage } from './pages/OrderCreatePage'
import { CartPage } from './pages/CartPage'
import { RentCheckoutPage } from './pages/RentCheckoutPage'
import { ContractPage } from './pages/ContractPage'
import { PaymentPage } from './pages/PaymentPage'
import { PayReminderPage } from './pages/PayReminderPage'
import { MyPage } from './pages/MyPage'
import { MyOrdersPage } from './pages/MyOrdersPage'
import { MyBillsPage } from './pages/MyBillsPage'
import { BillDetailPage } from './pages/BillDetailPage'
import { MyOrderDetailPage } from './pages/MyOrderDetailPage'
import { RealNameVerifyPage } from './pages/RealNameVerifyPage'
import { ProfilePage } from './pages/ProfilePage'
import { LedgerPayPage } from './pages/LedgerPayPage'

function App() {
  return (
    <MobileLayout>
      <Routes>
        <Route path="/" element={<HouseListPage />} />
        <Route path="/me" element={<MyPage />} />
        <Route path="/me/profile" element={<ProfilePage />} />
        <Route path="/me/orders" element={<MyOrdersPage />} />
        <Route path="/bills" element={<MyBillsPage />} />
        <Route path="/bills/:id" element={<BillDetailPage />} />
        <Route path="/me/orders/:id" element={<MyOrderDetailPage />} />
        <Route path="/me/verify" element={<RealNameVerifyPage />} />
        <Route path="/houses/:id" element={<HouseDetailPage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/order/:houseId" element={<OrderCreatePage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<RentCheckoutPage />} />
        <Route path="/contracts/:id" element={<ContractPage />} />
        <Route path="/pay/:contractId" element={<PaymentPage />} />
        <Route path="/remind-pay/:contractId" element={<PayReminderPage />} />
        <Route path="/ledger-pay/:id" element={<LedgerPayPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MobileLayout>
  )
}

export default App
