import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('ga_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
      localStorage.removeItem('ga_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  login:  (email, password) => api.post('/auth/login', { email, password }),
  me:     () => api.get('/auth/me')
};

export const faceAPI = {
  enroll:         (descriptor)         => api.post('/face/enroll', { descriptor }),
  enrollForUser:  (userId, descriptor) => api.post(`/face/enroll/${userId}`, { descriptor }),
  removeForUser:  (userId)             => api.delete(`/face/enroll/${userId}`),
  verify:         (descriptor)         => api.post('/face/verify', { descriptor }),
  status:         ()                   => api.get('/face/status')
};

export const usersAPI = {
  list:   ()           => api.get('/users'),
  create: (data)       => api.post('/users', data),
  update: (id, data)   => api.put(`/users/${id}`, data),
  block:  (id)         => api.post(`/users/${id}/block`),
  delete: (id)         => api.delete(`/users/${id}`)
};

export const zonesAPI = {
  list:   ()           => api.get('/zones'),
  create: (data)       => api.post('/zones', data),
  update: (id, data)   => api.put(`/zones/${id}`, data),
  delete: (id)         => api.delete(`/zones/${id}`)
};

export const holidaysAPI = {
  list:   ()           => api.get('/holidays'),
  create: (data)       => api.post('/holidays', data),
  delete: (id)         => api.delete(`/holidays/${id}`)
};

export const attendanceAPI = {
  checkin:             (data)         => api.post('/attendance/checkin', data),
  checkout:            (data)         => api.post('/attendance/checkout', data),
  list:                (params)       => api.get('/attendance', { params }),
  update:              (id, data)     => api.put(`/attendance/${id}`, data),
  delete:              (id)           => api.delete(`/attendance/${id}`),
  bulk:                (data)         => api.post('/attendance/bulk', data),
  bulkRange:           (data)         => api.post('/attendance/bulk-range', data),
  monthlyReport:       (month)        => api.get('/attendance/monthly-report', { params: { month } }),
  requestOverride:     (data)         => api.post('/attendance/override-request', data),
  getOverrideRequests: (status)       => api.get('/attendance/override-requests', { params: { status } }),
  getMyOverride:       ()             => api.get('/attendance/my-override'),
  reviewOverride:      (id, decision, note) => api.post(`/attendance/override-requests/${id}/review`, { decision, note })
};

export const leavesAPI = {
  // Employee
  apply:    (data)                    => api.post('/leaves', data),
  myLeaves: ()                        => api.get('/leaves/my'),
  cancel:   (id)                      => api.post(`/leaves/${id}/cancel`),
  // Admin
  list:     (params)                  => api.get('/leaves', { params }),
  review:   (id, decision, adminNote) => api.post(`/leaves/${id}/review`, { decision, adminNote }),
  delete:   (id)                      => api.delete(`/leaves/${id}`),
  summary:  (year)                    => api.get('/leaves/summary', { params: { year } })
};

export const statsAPI = {
  get: () => api.get('/stats')
};

export const auditAPI = {
  list: () => api.get('/audit')
};

export const settingsAPI = {
  get:    ()     => api.get('/settings'),
  update: (data) => api.put('/settings', data)
};

export default api;