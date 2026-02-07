const {
  getEventAlbumSummary,
  getEventAlbum,
  createEventAlbumPhoto,
  getEventAlbumPhotoDownloadUrl,
  deleteEventAlbumPhoto,
} = require('../../utils/api');
const { track } = require('../../utils/analytics');

const REFRESH_TTL_MS = 30000;
const PAGE_LIMIT = 20;
const MAX_UPLOAD_COUNT = 9;

Page({
  data: {
    eventId: null,
    totalPhotos: 0,
    canView: false,
    canUpload: false,
    backendUnavailable: false,
    photos: [],
    waterfallLeft: [],
    waterfallRight: [],
    offset: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    uploading: false,
    previewVisible: false,
    previewIndex: 0,
    currentPreview: null,
  },

  onLoad(query) {
    const eventId = query && query.id ? Number(query.id) : null;
    this.setData({ eventId: Number.isFinite(eventId) ? eventId : null });
    this.lastLoadedAt = 0;
    this.loadingPromise = null;
    this._viewTracked = false;
    track('album_page_open', { event_id: Number.isFinite(eventId) ? String(eventId) : '' });
    this.refreshAlbum(true);
  },

  onShow() {
    this.refreshAlbum(false);
  },

  shouldRefresh(force) {
    if (force) return true;
    if (!this.lastLoadedAt) return true;
    return Date.now() - this.lastLoadedAt > REFRESH_TTL_MS;
  },

  isCloudFileId(value) {
    return typeof value === 'string' && value.indexOf('cloud://') === 0;
  },

  async resolveMediaUrls(fileIds = []) {
    const cloudIds = Array.from(new Set(
      (fileIds || []).filter((item) => this.isCloudFileId(item))
    ));
    if (cloudIds.length === 0) return {};

    try {
      const res = await wx.cloud.getTempFileURL({ fileList: cloudIds });
      const fileList = (res && res.fileList) || [];
      return fileList.reduce((acc, item) => {
        if (item && item.fileID) {
          acc[item.fileID] = item.tempFileURL || item.fileID;
        }
        return acc;
      }, {});
    } catch (err) {
      console.error('Resolve album media failed', err);
      return {};
    }
  },

  formatDateTime(raw) {
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  },

  async refreshAlbum(force = false) {
    if (!this.data.eventId) {
      this.setData({ loading: false });
      return;
    }
    if (!this.shouldRefresh(force) || this.loadingPromise) {
      return;
    }

    this.setData({ loading: true });
    this.loadingPromise = (async () => {
      try {
        const summary = await getEventAlbumSummary(this.data.eventId);
        const canView = !!(summary && summary.can_view);
        const canUpload = !!(summary && summary.can_upload);
        const totalPhotos = Number(summary && summary.total_photos ? summary.total_photos : 0);
        const backendUnavailable = !!(summary && summary.backend_unavailable);

        this.setData({
          canView,
          canUpload,
          backendUnavailable,
          totalPhotos,
          photos: canView ? this.data.photos : [],
          offset: canView ? this.data.offset : 0,
          hasMore: canView ? this.data.hasMore : false,
        });

        if (canView) {
          await this.loadPhotos(true);
          if (!this._viewTracked) {
            this._viewTracked = true;
            track('album_view', {
              event_id: String(this.data.eventId),
              total_photos: totalPhotos,
              can_upload: canUpload ? 1 : 0,
            });
          }
        }

        this.lastLoadedAt = Date.now();
      } catch (err) {
        console.error('Refresh album failed', err);
        wx.showToast({ title: err && err.message ? err.message : '相册加载失败', icon: 'none' });
      } finally {
        this.setData({ loading: false });
      }
    })();

    await this.loadingPromise;
    this.loadingPromise = null;
  },

  async loadPhotos(reset = false) {
    if (!this.data.eventId || !this.data.canView) return;

    const currentOffset = reset ? 0 : this.data.offset;
    const loadingKey = reset ? 'loading' : 'loadingMore';
    this.setData({ [loadingKey]: true });

    try {
      const result = await getEventAlbum(this.data.eventId, {
        offset: currentOffset,
        limit: PAGE_LIMIT,
      });
      const list = result && Array.isArray(result.photos) ? result.photos : [];

      const fileIds = [];
      list.forEach((item) => {
        if (item && item.file_id) fileIds.push(item.file_id);
        if (item && item.thumb_file_id) fileIds.push(item.thumb_file_id);
      });
      const mediaMap = await this.resolveMediaUrls(fileIds);

      const mapped = list.map((item) => ({
        ...item,
        createdText: this.formatDateTime(item.created_at),
        thumbUrl: mediaMap[item.thumb_file_id] || mediaMap[item.file_id] || item.thumb_file_id || item.file_id || '',
        previewUrl: mediaMap[item.file_id] || item.file_id || '',
      }));

      const merged = reset ? mapped : this.data.photos.concat(mapped);
      const pagination = result && result.pagination ? result.pagination : {};
      const hasMore = !!pagination.has_more;
      const nextOffset = Number.isFinite(Number(pagination.next_offset))
        ? Number(pagination.next_offset)
        : merged.length;

      const wf = this.buildWaterfall(merged);
      const nextPreview = this.data.previewVisible
        ? (merged[this.data.previewIndex] || null)
        : null;

      this.setData({
        photos: merged,
        waterfallLeft: wf.left,
        waterfallRight: wf.right,
        offset: hasMore ? nextOffset : merged.length,
        hasMore,
        currentPreview: nextPreview,
      });
    } catch (err) {
      console.error('Load album photos failed', err);
      wx.showToast({ title: err && err.message ? err.message : '照片加载失败', icon: 'none' });
    } finally {
      this.setData({ [loadingKey]: false });
    }
  },

  estimateWaterfallScore(item) {
    const w = Number(item && item.width ? item.width : 0);
    const h = Number(item && item.height ? item.height : 0);
    // Use aspect ratio as a stable proxy for layout height. Add a small constant
    // for the meta strip to keep columns balanced.
    if (w > 0 && h > 0) {
      return h / w + 0.12;
    }
    return 1.12;
  },

  buildWaterfall(list) {
    const left = [];
    const right = [];
    let leftSum = 0;
    let rightSum = 0;
    (list || []).forEach((item) => {
      const score = this.estimateWaterfallScore(item);
      if (leftSum <= rightSum) {
        left.push(item);
        leftSum += score;
      } else {
        right.push(item);
        rightSum += score;
      }
    });
    return { left, right };
  },

  getFileExt(path = '') {
    const match = /\.([a-zA-Z0-9]+)$/.exec(String(path || ''));
    return match && match[1] ? match[1].toLowerCase() : 'jpg';
  },

  async getImageInfo(path) {
    if (!path) return { width: null, height: null };
    try {
      const info = await wx.getImageInfo({ src: path });
      return {
        width: info && info.width ? info.width : null,
        height: info && info.height ? info.height : null,
      };
    } catch (err) {
      return { width: null, height: null };
    }
  },

  async tryUploadThumb(eventId, originPath, index) {
    try {
      const compressed = await wx.compressImage({
        src: originPath,
        quality: 45,
      });
      if (!compressed || !compressed.tempFilePath) return '';
      const ext = this.getFileExt(compressed.tempFilePath);
      const cloudPath = `albums/events/${eventId}/thumbs/${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const res = await wx.cloud.uploadFile({
        cloudPath,
        filePath: compressed.tempFilePath,
      });
      return res && res.fileID ? res.fileID : '';
    } catch (err) {
      return '';
    }
  },

  async chooseAndUpload() {
    if (!this.data.eventId) return;
    if (!this.data.canUpload) {
      wx.showToast({ title: '仅参赛选手可上传', icon: 'none' });
      return;
    }
    if (this.data.uploading) return;

    try {
      const chooser = await wx.chooseMedia({
        count: MAX_UPLOAD_COUNT,
        mediaType: ['image'],
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
      });

      const files = chooser && Array.isArray(chooser.tempFiles) ? chooser.tempFiles : [];
      if (!files.length) return;

      this.setData({ uploading: true });
      track('album_upload_start', {
        event_id: String(this.data.eventId),
        count: files.length,
      });

      let successCount = 0;
      let failedCount = 0;
      for (let i = 0; i < files.length; i += 1) {
        const item = files[i];
        try {
          const filePath = item && item.tempFilePath ? item.tempFilePath : '';
          if (!filePath) throw new Error('图片路径无效');

          const ext = this.getFileExt(filePath);
          const cloudPath = `albums/events/${this.data.eventId}/${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath,
          });
          const fileId = uploadRes && uploadRes.fileID ? uploadRes.fileID : '';
          if (!fileId) throw new Error('上传失败');

          const thumbFileId = await this.tryUploadThumb(this.data.eventId, filePath, i);
          const info = await this.getImageInfo(filePath);

          await createEventAlbumPhoto(this.data.eventId, {
            file_id: fileId,
            thumb_file_id: thumbFileId || undefined,
            file_path: cloudPath,
            mime_type: item && item.fileType ? `image/${item.fileType}` : `image/${ext}`,
            width: info.width,
            height: info.height,
            size_bytes: item && item.size ? item.size : null,
          });

          successCount += 1;
        } catch (err) {
          console.error('Upload album item failed', err);
          failedCount += 1;
        }
      }

      if (successCount > 0) {
        wx.showToast({ title: `上传成功 ${successCount} 张`, icon: 'success' });
      }
      if (failedCount > 0) {
        wx.showToast({ title: `失败 ${failedCount} 张`, icon: 'none' });
      }

      track('album_upload_result', {
        event_id: String(this.data.eventId),
        success: successCount,
        failed: failedCount,
      });

      await this.refreshAlbum(true);
    } catch (err) {
      if (err && err.errMsg && err.errMsg.includes('cancel')) return;
      console.error('Choose and upload failed', err);
      wx.showToast({ title: '上传失败，请重试', icon: 'none' });
    } finally {
      this.setData({ uploading: false });
    }
  },

  handlePreview(e) {
    if (!this.data.canView) return;
    const targetId = e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.id) : null;
    if (!Number.isFinite(targetId)) return;

    const current = this.data.photos.find((item) => Number(item.id) === targetId);
    if (!current) return;

    const index = this.data.photos.findIndex((item) => Number(item.id) === targetId);
    this.setData({
      previewVisible: true,
      previewIndex: index >= 0 ? index : 0,
      currentPreview: current,
    });
  },

  noop() {},

  closePreview() {
    this.setData({ previewVisible: false });
  },

  handlePreviewChange(e) {
    const idx = e && e.detail ? Number(e.detail.current) : 0;
    const next = this.data.photos && this.data.photos[idx] ? this.data.photos[idx] : null;
    this.setData({
      previewIndex: Number.isFinite(idx) ? idx : 0,
      currentPreview: next,
    });
  },

  async handleLoadMore() {
    if (this.data.loadingMore || !this.data.hasMore || this.data.loading) return;
    await this.loadPhotos(false);
  },

  async downloadFile(url) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url,
        success: (res) => {
          if (res && res.statusCode === 200 && res.tempFilePath) {
            resolve(res.tempFilePath);
            return;
          }
          reject(new Error('download_failed'));
        },
        fail: reject,
      });
    });
  },

  async saveImage(path) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath: path,
        success: resolve,
        fail: reject,
      });
    });
  },

  async downloadPhoto(photoId) {
    wx.showLoading({ title: '准备下载', mask: true });
    try {
      track('album_download', {
        event_id: String(this.data.eventId || ''),
        photo_id: String(photoId),
      });
      const result = await getEventAlbumPhotoDownloadUrl(this.data.eventId, photoId);
      let url = result && (result.download_url || result.download_url_encoded)
        ? (result.download_url || result.download_url_encoded)
        : '';

      if (!url && result && result.file_id && this.isCloudFileId(result.file_id)) {
        const resolved = await wx.cloud.getTempFileURL({ fileList: [result.file_id] });
        const fileList = (resolved && resolved.fileList) || [];
        const first = fileList[0] || {};
        url = first.tempFileURL || '';
      }
      if (!url) throw new Error('下载链接无效');

      const tempPath = await this.downloadFile(url);
      await this.saveImage(tempPath);
      wx.showToast({ title: '已保存到系统相册', icon: 'success' });
    } catch (err) {
      console.error('Download photo failed', err);
      const text = String((err && err.errMsg) || (err && err.message) || '');
      if (text.includes('auth deny') || text.includes('auth denied')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中开启“保存到相册”权限后重试',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting();
            }
          },
        });
      } else {
        wx.showToast({ title: '下载失败，请稍后重试', icon: 'none' });
      }
    } finally {
      wx.hideLoading();
    }
  },

  async downloadCurrent() {
    const current = this.data.currentPreview;
    const photoId = current && current.id ? Number(current.id) : null;
    if (!Number.isFinite(photoId)) return;
    await this.downloadPhoto(photoId);
  },

  async handleDelete(e) {
    const photoId = e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.id) : null;
    if (!Number.isFinite(photoId)) return;

    const current = this.data.photos.find((item) => Number(item.id) === photoId);
    if (!current || !current.can_delete) return;

    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '删除照片',
        content: '删除后将从赛事相册中移除，确认继续吗？',
        confirmText: '删除',
        confirmColor: '#f97316',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!modal || !modal.confirm) return;

    try {
      await deleteEventAlbumPhoto(this.data.eventId, photoId);
      const nextPhotos = this.data.photos.filter((item) => Number(item.id) !== photoId);
      const nextWf = this.buildWaterfall(nextPhotos);
      this.setData({
        photos: nextPhotos,
        waterfallLeft: nextWf.left,
        waterfallRight: nextWf.right,
        totalPhotos: Math.max(Number(this.data.totalPhotos || 0) - 1, 0),
      });
      track('album_delete', {
        event_id: String(this.data.eventId || ''),
        photo_id: String(photoId),
      });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      console.error('Delete photo failed', err);
      wx.showToast({ title: err && err.message ? err.message : '删除失败', icon: 'none' });
    }
  },

  async deleteCurrent() {
    const current = this.data.currentPreview;
    const photoId = current && current.id ? Number(current.id) : null;
    if (!Number.isFinite(photoId)) return;
    if (!current || !current.can_delete) return;

    // Reuse the same delete confirmation UX.
    await this.handleDelete({ currentTarget: { dataset: { id: photoId } } });
    this.setData({ previewVisible: false });
  },
});
