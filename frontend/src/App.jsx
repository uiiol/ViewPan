import { useState, useEffect } from "react";
import { Layout, Tabs, Typography, Dropdown, Button } from "antd";
import { useNavigate, useLocation } from "react-router-dom";
import ChannelPage from "./pages/ChannelPage";
import CustomerPage from "./pages/CustomerPage";
import DashboardPage from "./pages/DashboardPage";
import UserManagement from "./pages/UserManagement";
import LoginPage from "./pages/LoginPage";
import "./App.css";

const { Header, Content } = Layout;
const { Title } = Typography;

function getUser() {
  try {
    const u = localStorage.getItem("user");
    return u ? JSON.parse(u) : null;
  } catch { return null; }
}

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const token = localStorage.getItem("token");
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();

  // 未登录 → 跳转登录页
  if (!token) {
    return <LoginPage />;
  }

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const isUserManagement = activeTab === "usermanage";
  const isAdmin = user?.role === "admin";

  return (
    <Layout style={{ minHeight: "100vh", background: "#f0f2f5" }}>
      <Header style={{ background: "#001529", padding: "0 24px", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 200 }}>
        <Title level={4} style={{ color: "#fff", margin: "0 32px 0 0", whiteSpace: "nowrap" }}>外呼数据可视化大盘</Title>
        <Tabs
          activeKey={activeTab}
          onChange={k => {
            if (k !== "usermanage") setActiveTab(k);
            else setActiveTab("channel"); // user management 放在下拉菜单
          }}
          items={[
            { key: "dashboard", label: "数据大盘" },
            { key: "channel", label: "渠道商分析" },
            { key: "customer", label: "单一客户分析" },
          ]}
          style={{ flex: 1 }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isAdmin && (
            <Button type="link" style={{ color: "#fff" }} onClick={() => setActiveTab("usermanage")}>
              账号管理
            </Button>
          )}
          <Dropdown menu={{
            items: [
              { key: "username", label: `当前账号: ${user?.username}` },
              { key: "role", label: `角色: ${user?.role === "admin" ? "管理员" : "普通用户"}` },
              { type: "divider" },
              { key: "logout", label: "退出登录", danger: true },
            ],
            onClick: ({ key }) => { if (key === "logout") handleLogout(); },
          }}>
            <Button style={{ color: "#fff" }}>👤 {user?.username}</Button>
          </Dropdown>
        </div>
      </Header>
      <Content>
        {isUserManagement ? <UserManagement /> : activeTab === "dashboard" ? <DashboardPage /> : activeTab === "channel" ? <ChannelPage onNavigateToCustomer={() => setActiveTab("customer")} /> : <CustomerPage />}
      </Content>
    </Layout>
  );
}
