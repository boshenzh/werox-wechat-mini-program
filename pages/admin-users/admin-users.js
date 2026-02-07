/**
 * Admin Users Management Page
 * Allows admin-role users to view and change user roles.
 */

const { listUsers, updateUserRole } = require('../../utils/api');
const { getUserRole } = require('../../utils/user');
const { track } = require('../../utils/analytics');

const ROLE_LABELS = {
  runner: '用户',
  coach: '教练',
  organizer: '组织者',
  admin: '管理员',
};

const ROLE_OPTIONS = [
  { role: 'runner', label: '用户' },
  { role: 'coach', label: '教练' },
  { role: 'organizer', label: '组织者' },
  { role: 'admin', label: '管理员' },
];

Page({
  data: {
    users: [],
    loading: true,
    loadingMore: false,
    hasMore: false,
    searchText: '',
    offset: 0,
    limit: 20,
  },

  _searchTimer: null,

  async onLoad() {
    // Check admin permission
    const role = await getUserRole();
    if (role !== 'admin') {
      wx.showToast({ title: '仅管理员可访问', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.fetchUsers({ reset: true });
  },

  onPullDownRefresh() {
    this.fetchUsers({ reset: true, stopPullDown: true });
  },

  async fetchUsers(options = {}) {
    const { reset = false, stopPullDown = false } = options;

    if (reset) {
      this.setData({ loading: true, offset: 0, users: [], hasMore: false });
    } else {
      this.setData({ loadingMore: true });
    }

    try {
      const result = await listUsers({
        limit: this.data.limit,
        offset: reset ? 0 : this.data.offset,
        search: this.data.searchText,
      });

      const newUsers = (result && result.users || []).map((u) => ({
        ...u,
        roleLabel: ROLE_LABELS[u.role] || '用户',
      }));

      const pagination = result && result.pagination || {};
      const hasMore = !!pagination.has_more;
      const nextOffset = pagination.next_offset || (this.data.offset + this.data.limit);

      if (reset) {
        this.setData({
          users: newUsers,
          hasMore,
          offset: nextOffset,
        });
      } else {
        this.setData({
          users: [...this.data.users, ...newUsers],
          hasMore,
          offset: nextOffset,
        });
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
      wx.showToast({ title: '加载用户失败', icon: 'none' });
    } finally {
      this.setData({ loading: false, loadingMore: false });
      if (stopPullDown) wx.stopPullDownRefresh();
    }
  },

  onSearchInput(e) {
    const value = e.detail.value || '';
    this.setData({ searchText: value });

    // Debounce search
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
    }
    this._searchTimer = setTimeout(() => {
      this.fetchUsers({ reset: true });
    }, 400);
  },

  onSearchConfirm() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.fetchUsers({ reset: true });
  },

  clearSearch() {
    this.setData({ searchText: '' });
    this.fetchUsers({ reset: true });
  },

  loadMore() {
    if (this.data.loadingMore || !this.data.hasMore) return;
    this.fetchUsers({ reset: false });
  },

  onRoleTap(e) {
    const { userId, userName, currentRole } = e.currentTarget.dataset;
    const displayName = userName || '该用户';

    const itemList = ROLE_OPTIONS.map((opt) => {
      const mark = opt.role === currentRole ? ' (当前)' : '';
      return `${opt.label}${mark}`;
    });

    wx.showActionSheet({
      itemList,
      success: (res) => {
        const selected = ROLE_OPTIONS[res.tapIndex];
        if (!selected || selected.role === currentRole) return;
        this.confirmRoleChange(userId, displayName, selected);
      },
    });
  },

  confirmRoleChange(userId, displayName, selected) {
    wx.showModal({
      title: '确认修改角色',
      content: `将"${displayName}"的角色改为"${selected.label}"？`,
      confirmText: '确认',
      confirmColor: '#f59e0b',
      success: (res) => {
        if (res.confirm) {
          this.doRoleUpdate(userId, selected.role);
        }
      },
    });
  },

  async doRoleUpdate(userId, newRole) {
    wx.showLoading({ title: '修改中...' });
    try {
      await updateUserRole(userId, newRole);

      // Update local state
      const users = this.data.users.map((u) => {
        if (u.id === userId) {
          return {
            ...u,
            role: newRole,
            roleLabel: ROLE_LABELS[newRole] || '用户',
          };
        }
        return u;
      });
      this.setData({ users });

      wx.hideLoading();
      wx.showToast({ title: '已修改', icon: 'success' });
      track('admin_role_change', { target_user_id: userId, new_role: newRole });
    } catch (err) {
      wx.hideLoading();
      console.error('Failed to update role:', err);
      const msg = err && err.message ? err.message : '角色修改失败';
      wx.showToast({ title: msg, icon: 'none' });
    }
  },
});
