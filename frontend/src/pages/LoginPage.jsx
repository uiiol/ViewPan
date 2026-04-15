import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Form, Input, Button, Card, message } from "antd";
import { postLogin, postInitAdmin } from "../api";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const onFinish = async ({ username, password }) => {
    setLoading(true);
    try {
      const res = await postLogin({ username, password });
      localStorage.setItem("token", res.token);
      localStorage.setItem("user", JSON.stringify({ username: res.username, role: res.role }));
      message.success("登录成功");
      navigate("/");
    } catch (err) {
      message.error(err?.response?.data?.detail || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const initAdmin = async () => {
    try {
      const res = await postInitAdmin();
      message.success(`管理员已创建：${res.username} / ${res.password}`);
    } catch (err) {
      message.error(err?.response?.data?.detail || "初始化失败");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #001529 0%, #1677ff 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <Card title={<span style={{ fontSize: 20 }}>外呼数据可视化大盘</span>} style={{ width: 360 }}>
        <Form layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item
            name="username"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input placeholder="用户名" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: "请输入密码" }]}
          >
            <Input.Password placeholder="密码" size="large" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block size="large">
              登录
            </Button>
          </Form.Item>
        </Form>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Button type="link" size="small" onClick={initAdmin}>
            初始化管理员账号
          </Button>
        </div>
      </Card>
    </div>
  );
}
