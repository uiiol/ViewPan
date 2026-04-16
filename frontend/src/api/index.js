import axios from "axios";

const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000" });

// 请求拦截器：自动带上 Token
api.interceptors.request.use(config => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：Token 过期则跳转登录
api.interceptors.response.use(
  resp => resp,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export const getYears = () => api.get("/api/analytics/years").then(r => r.data);
export const getMonths = (year) => api.get("/api/analytics/months", { params: { year } }).then(r => r.data);
export const getCompanies = (params) => api.get("/api/analytics/companies", { params }).then(r => r.data);
export const getChannels = () => api.get("/api/analytics/channels").then(r => r.data);
export const getOverview = (params) => api.get("/api/analytics/overview", { params }).then(r => r.data);
export const getMonthlyTrend = (params) => api.get("/api/analytics/trend/monthly", { params }).then(r => r.data);
export const getDailyTrend = (params) => api.get("/api/analytics/trend/daily", { params }).then(r => r.data);
export const getCompanyRanking = (params) => api.get("/api/analytics/companies/ranking", { params }).then(r => r.data);
export const getChannelRanking = (params) => api.get("/api/analytics/channels/ranking", { params }).then(r => r.data);
export const getChannelOverview = (params) => api.get("/api/analytics/channels/overview", { params }).then(r => r.data);
export const getChannelConcentration = (params) => api.get("/api/analytics/channels/concentration", { params }).then(r => r.data);
export const getDashboardSummary = (params) => api.get("/api/analytics/dashboard/summary", { params }).then(r => r.data);
export const postAiAnalysis = (data) => api.post("/api/analytics/ai-analysis", data).then(r => r.data);

// Auth API
export const postLogin = (data) => api.post("/api/auth/login", data).then(r => r.data);
export const postRegister = (data) => api.post("/api/auth/register", data).then(r => r.data);
export const getMe = () => api.get("/api/auth/me").then(r => r.data);
export const getUsers = () => api.get("/api/auth/users").then(r => r.data);
export const deleteUser = (id) => api.delete(`/api/auth/users/${id}`).then(r => r.data);
export const postInitAdmin = () => api.post("/api/auth/init-admin").then(r => r.data);
