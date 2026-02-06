const { getCurrentOpenid, getUserRole } = require('../../utils/user');
const {
  deriveEventStatus,
  formatDateToHM,
  formatDateToYMD,
  normalizeDetailBlocks,
  normalizeDivisions,
  parseDateTime,
  safeNumber,
  toDateTimeString,
} = require('../../utils/event');
const { exportEventParticipantsCsv } = require('../../utils/export');

const HYROX_DIVISIONS = [
  { value: 'Open男', label: 'Open男' },
  { value: 'Open女', label: 'Open女' },
  { value: 'Pro男', label: 'Pro男' },
  { value: 'Pro女', label: 'Pro女' },
  { value: 'Doubles男双', label: 'Doubles男双' },
  { value: 'Doubles女双', label: 'Doubles女双' },
  { value: 'Doubles混双', label: 'Doubles混双' },
  { value: 'Relay男', label: 'Relay男' },
  { value: 'Relay女', label: 'Relay女' },
  { value: 'Relay混合', label: 'Relay混合' },
];

const CASUAL_DIVISIONS = [
  { value: '个人体验组', label: '个人体验组' },
  { value: '双人同伴组', label: '双人同伴组' },
  { value: '团队接力组', label: '团队接力组' },
];

const HYROX_STATION_NAMES = [
  '跑步',
  '滑雪机 (SkiErg)',
  '雪橇推 (Sled Push)',
  '雪橇拉 (Sled Pull)',
  '波比跳开合跳 (Burpee Broad Jump)',
  '划船机 (Row)',
  '农夫走 (Farmers Carry)',
  '弓步负重 (Lunges)',
  '墙球 (Wall Balls)',
  '自定义',
];

const CASUAL_STATION_NAMES = [
  '热身跑',
  '伙伴接力',
  '团队搬运',
  '核心循环',
  '趣味冲刺',
  '自定义',
];

const HYROX_STATION_PRESETS = [
  { station_name: '跑步', target_type: 'distance', target_value: 1000, target_unit: '米' },
  { station_name: '滑雪机 (SkiErg)', target_type: 'distance', target_value: 1000, target_unit: '米' },
  { station_name: '雪橇推 (Sled Push)', target_type: 'distance', target_value: 50, target_unit: '米' },
  { station_name: '雪橇拉 (Sled Pull)', target_type: 'distance', target_value: 50, target_unit: '米' },
  { station_name: '墙球 (Wall Balls)', target_type: 'reps', target_value: 100, target_unit: '次' },
];

const CASUAL_STATION_PRESETS = [
  { station_name: '热身跑', target_type: 'distance', target_value: 400, target_unit: '米' },
  { station_name: '伙伴接力', target_type: 'time', target_value: 180, target_unit: '秒' },
  { station_name: '团队搬运', target_type: 'distance', target_value: 60, target_unit: '米' },
  { station_name: '趣味冲刺', target_type: 'reps', target_value: 30, target_unit: '次' },
];

function defaultStationForm() {
  return {
    station_name: '',
    custom_station_name: '',
    station_description: '',
    target_type: 'distance',
    target_value: '',
    target_unit: '米',
    weight_male_kg: '',
    weight_female_kg: '',
    weight_note: '',
    equipment_note: '',
    rest_after_seconds: 0,
  };
}

function defaultDetailForm() {
  return {
    title: '',
    content: '',
    image_url: '',
  };
}

Page({
  data: {
    openid: '',
    role: 'runner',
    isAllowed: false,
    events: [],
    editingId: null,
    exportingId: null,
    templateOptions: ['hyrox_official', 'werox_casual'],
    templateLabels: ['HYROX官方格式', 'Werox Casual'],
    templateIndex: 1,
    formatModeOptions: ['for_time', 'time_cap', 'amrap', 'emom', 'rounds'],
    formatModeLabels: ['竞速完赛', '限时完赛', 'AMRAP', 'EMOM', '固定轮数'],
    formatModeIndex: 0,
    eventTypeOptions: ['official', 'simulation', 'training', 'community'],
    eventTypeLabels: ['官方赛事', '模拟赛', '训练赛', '社区活动'],
    eventTypeIndex: 1,
    form: {
      title: '',
      slug: '',
      start_date: '',
      start_time: '',
      end_date: '',
      end_time: '',
      location: '',
      latitude: null,
      longitude: null,
      venue_name: '',
      cover_url: '',
      description: '',
      event_template: 'werox_casual',
      format_mode: 'for_time',
      event_type: 'simulation',
      time_cap_minutes: '',
      total_rounds: 1,
      use_standard_hyrox: false,
      available_divisions: [],
      base_strength: 5,
      base_endurance: 5,
      max_participants: '',
      price_fee: '',
    },
    detailBlocks: [],
    detailForm: defaultDetailForm(),
    stations: [],
    stationForm: defaultStationForm(),
    targetTypeOptions: ['distance', 'reps', 'time', 'calories'],
    targetTypeLabels: ['距离', '次数', '时间', '卡路里'],
    targetTypeIndex: 0,
    stationNameOptions: CASUAL_STATION_NAMES,
    stationNameIndex: 0,
    stationPresets: CASUAL_STATION_PRESETS,
    divisionCheckboxes: CASUAL_DIVISIONS.map((item) => ({ ...item, checked: false })),
  },

  onLoad() {
    this.initRole();
  },

  async initRole() {
    try {
      const openid = await getCurrentOpenid();
      const role = await getUserRole(openid);
      const isAllowed = role === 'admin' || role === 'organizer';

      this.setData({ openid, role, isAllowed });

      if (!isAllowed) {
        wx.showToast({ title: '无权限操作', icon: 'none' });
        return;
      }

      await this.loadEvents();
    } catch (err) {
      console.error('Role check failed', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  getDivisionPool(template = this.data.form.event_template) {
    return template === 'hyrox_official' ? HYROX_DIVISIONS : CASUAL_DIVISIONS;
  },

  getStationNameOptions(template = this.data.form.event_template) {
    return template === 'hyrox_official' ? HYROX_STATION_NAMES : CASUAL_STATION_NAMES;
  },

  getStationPresets(template = this.data.form.event_template) {
    return template === 'hyrox_official' ? HYROX_STATION_PRESETS : CASUAL_STATION_PRESETS;
  },

  normalizeDivisionCheckboxes(template, selectedValues = []) {
    return this.getDivisionPool(template).map((item) => ({
      ...item,
      checked: selectedValues.includes(item.value),
    }));
  },

  syncTemplateState(template, selectedValues = []) {
    const divisionCheckboxes = this.normalizeDivisionCheckboxes(template, selectedValues);
    const stationNameOptions = this.getStationNameOptions(template);
    const stationPresets = this.getStationPresets(template);

    this.setData({
      stationNameOptions,
      stationPresets,
      divisionCheckboxes,
      stationNameIndex: 0,
      'form.event_template': template,
      'form.available_divisions': selectedValues,
      'stationForm.station_name': '',
      'stationForm.custom_station_name': '',
    });
  },

  handleInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },

  handleDateTimeChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  chooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        if (res.name || res.address) {
          this.setData({
            'form.location': res.name || res.address,
            'form.venue_name': res.name || this.data.form.venue_name,
            'form.latitude': res.latitude,
            'form.longitude': res.longitude,
          });
        }
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        console.error('Choose location failed', err);
        wx.showToast({ title: '请授权位置权限', icon: 'none' });
      },
    });
  },

  handleTemplateChange(e) {
    const index = Number(e.detail.value);
    const template = this.data.templateOptions[index] || 'werox_casual';
    const selected = (this.data.form.available_divisions || []).filter((value) => (
      this.getDivisionPool(template).some((item) => item.value === value)
    ));

    this.setData({ templateIndex: index });
    this.syncTemplateState(template, selected);
  },

  handleFormatModeChange(e) {
    const index = Number(e.detail.value);
    const mode = this.data.formatModeOptions[index];
    this.setData({
      formatModeIndex: index,
      'form.format_mode': mode,
    });
  },

  handleEventTypeChange(e) {
    const index = Number(e.detail.value);
    const type = this.data.eventTypeOptions[index];
    this.setData({
      eventTypeIndex: index,
      'form.event_type': type,
    });
  },

  handleSliderChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },

  handleSwitchChange(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },

  handleDivisionChange(e) {
    const selectedValues = e.detail.value || [];
    const checkboxes = this.normalizeDivisionCheckboxes(this.data.form.event_template, selectedValues);
    this.setData({
      divisionCheckboxes: checkboxes,
      'form.available_divisions': selectedValues,
    });
  },

  async loadEvents() {
    try {
      const db = await getApp().globalData.getDB();
      const { data: events, error } = await db
        .from('events')
        .select('*')
        .order('event_date', { ascending: true });

      if (error) {
        console.error('Load events failed', error);
        wx.showToast({ title: '赛事加载失败', icon: 'none' });
        return;
      }

      const mapped = (events || []).map((item) => {
        const statusInfo = deriveEventStatus(item);
        const feeInCent = safeNumber(
          item.price_fee !== null && item.price_fee !== undefined ? item.price_fee : item.price_open,
          0
        );
        return {
          ...item,
          status: statusInfo.status,
          statusText: statusInfo.statusText,
          price_fee: feeInCent,
          templateText: item.event_template === 'hyrox_official' ? 'HYROX官方格式' : 'Werox Casual',
        };
      });

      this.setData({ events: mapped });
    } catch (err) {
      console.error('Load events failed', err);
      wx.showToast({ title: '赛事加载失败', icon: 'none' });
    }
  },

  async startEdit(e) {
    const id = e.currentTarget.dataset.id;
    const event = this.data.events.find((item) => item.id === id);
    if (!event) return;

    const template = event.event_template || 'werox_casual';
    const templateIndex = this.data.templateOptions.indexOf(template);
    const formatModeIndex = this.data.formatModeOptions.indexOf(event.format_mode || 'for_time');
    const eventTypeIndex = this.data.eventTypeOptions.indexOf(event.event_type || 'simulation');
    const availableDivisions = normalizeDivisions(event.available_divisions, template);

    const parsedStart = parseDateTime(event.start_at);
    const parsedEnd = parseDateTime(event.end_at);
    const fallbackStart = parseDateTime(toDateTimeString(event.event_date, event.event_time));
    const startDateObj = parsedStart || fallbackStart;
    const endDateObj = parsedEnd || (startDateObj ? new Date(startDateObj.getTime() + 2 * 60 * 60 * 1000) : null);

    const detailBlocks = normalizeDetailBlocks(event.detail_blocks, event.poster_url || '');

    this.setData({
      editingId: id,
      templateIndex: templateIndex >= 0 ? templateIndex : 1,
      formatModeIndex: formatModeIndex >= 0 ? formatModeIndex : 0,
      eventTypeIndex: eventTypeIndex >= 0 ? eventTypeIndex : 1,
      detailBlocks,
      detailForm: defaultDetailForm(),
      form: {
        title: event.title || '',
        slug: event.slug || '',
        start_date: formatDateToYMD(startDateObj) || event.event_date || '',
        start_time: formatDateToHM(startDateObj) || event.event_time || '',
        end_date: formatDateToYMD(endDateObj) || '',
        end_time: formatDateToHM(endDateObj) || '',
        location: event.location || '',
        latitude: event.latitude || null,
        longitude: event.longitude || null,
        venue_name: event.venue_name || '',
        cover_url: event.cover_url || '',
        description: event.description || '',
        event_template: template,
        format_mode: event.format_mode || 'for_time',
        event_type: event.event_type || 'simulation',
        time_cap_minutes: event.time_cap_minutes || '',
        total_rounds: event.total_rounds || 1,
        use_standard_hyrox: !!event.use_standard_hyrox,
        available_divisions: availableDivisions,
        base_strength: safeNumber(event.base_strength, 5),
        base_endurance: safeNumber(event.base_endurance, 5),
        max_participants: event.max_participants || '',
        price_fee: safeNumber(
          event.price_fee !== null && event.price_fee !== undefined ? event.price_fee : event.price_open,
          0
        ),
      },
    });

    this.syncTemplateState(template, availableDivisions);
    await this.loadStations(id);
  },

  async loadStations(eventId) {
    try {
      const db = await getApp().globalData.getDB();
      const { data: stations, error } = await db
        .from('event_stations')
        .select('*')
        .eq('event_id', eventId)
        .order('station_order', { ascending: true });

      if (error) {
        console.error('Load stations failed', error);
        this.setData({ stations: [] });
        return;
      }

      this.setData({ stations: stations || [] });
    } catch (err) {
      console.error('Load stations failed', err);
      this.setData({ stations: [] });
    }
  },

  resetForm() {
    this.setData({
      editingId: null,
      templateIndex: 1,
      formatModeIndex: 0,
      eventTypeIndex: 1,
      stations: [],
      detailBlocks: [],
      detailForm: defaultDetailForm(),
      stationForm: defaultStationForm(),
      targetTypeIndex: 0,
      stationNameIndex: 0,
      stationNameOptions: CASUAL_STATION_NAMES,
      stationPresets: CASUAL_STATION_PRESETS,
      divisionCheckboxes: this.normalizeDivisionCheckboxes('werox_casual', []),
      form: {
        title: '',
        slug: '',
        start_date: '',
        start_time: '',
        end_date: '',
        end_time: '',
        location: '',
        latitude: null,
        longitude: null,
        venue_name: '',
        cover_url: '',
        description: '',
        event_template: 'werox_casual',
        format_mode: 'for_time',
        event_type: 'simulation',
        time_cap_minutes: '',
        total_rounds: 1,
        use_standard_hyrox: false,
        available_divisions: [],
        base_strength: 5,
        base_endurance: 5,
        max_participants: '',
        price_fee: '',
      },
    });
  },

  generateSlug(title, date) {
    const normalizedTitle = (title || '')
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const normalizedDate = (date || '').replace(/[^\d]/g, '');
    return `${normalizedTitle}-${normalizedDate}`;
  },

  async deleteEvent(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;

    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '删除赛事',
        content: '删除后不可恢复，是否继续？',
        confirmText: '删除',
        cancelText: '取消',
        success: (res) => resolve(res.confirm),
        fail: () => resolve(false),
      });
    });
    if (!confirm) return;

    wx.showLoading({ title: '删除中...' });

    try {
      const db = await getApp().globalData.getDB();
      await db.from('events').delete().eq('id', id);

      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });

      if (this.data.editingId === id) this.resetForm();
      this.loadEvents();
    } catch (err) {
      wx.hideLoading();
      console.error('Delete event failed', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  async exportParticipants(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const event = this.data.events.find((item) => item.id === id);

    this.setData({ exportingId: id });
    wx.showLoading({ title: '导出中...' });
    try {
      const result = await exportEventParticipantsCsv({
        eventId: id,
        eventTitle: event ? event.title : '',
      });
      wx.hideLoading();
      wx.showToast({ title: `已导出 ${result.count} 人`, icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('Export participants failed', err);
      wx.showToast({ title: err.code === 'permission_denied' ? '无导出权限' : '导出失败', icon: 'none' });
    } finally {
      this.setData({ exportingId: null });
    }
  },

  async saveEvent() {
    if (!this.data.isAllowed) {
      wx.showToast({ title: '无权限操作', icon: 'none' });
      return;
    }

    const form = this.data.form;
    if (!form.title || !form.title.trim()) {
      wx.showToast({ title: '请填写活动名称', icon: 'none' });
      return;
    }
    if (!form.start_date || !form.start_time) {
      wx.showToast({ title: '请填写开始时间', icon: 'none' });
      return;
    }
    if (!form.end_date || !form.end_time) {
      wx.showToast({ title: '请填写结束时间', icon: 'none' });
      return;
    }

    const startAt = toDateTimeString(form.start_date, form.start_time);
    const endAt = toDateTimeString(form.end_date, form.end_time);
    const startDate = parseDateTime(startAt);
    const endDate = parseDateTime(endAt);
    if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' });
      return;
    }

    const slug = form.slug || this.generateSlug(form.title, form.start_date);
    const template = form.event_template || 'werox_casual';
    const isHyrox = template === 'hyrox_official';
    const fee = form.price_fee === '' ? 0 : Number(form.price_fee || 0);
    const statusInfo = deriveEventStatus({ start_at: startAt, end_at: endAt });

    const payload = {
      title: form.title.trim(),
      slug,
      event_date: form.start_date,
      event_time: form.start_time,
      start_at: startAt,
      end_at: endAt,
      location: form.location || '',
      latitude: form.latitude || null,
      longitude: form.longitude || null,
      venue_name: form.venue_name || '',
      cover_url: form.cover_url || '',
      description: form.description || '',
      status: statusInfo.status,
      event_template: template,
      format_mode: isHyrox ? (form.format_mode || 'for_time') : 'for_time',
      event_type: form.event_type || 'simulation',
      time_cap_minutes: isHyrox && (form.format_mode === 'time_cap' || form.format_mode === 'amrap' || form.format_mode === 'emom')
        ? Number(form.time_cap_minutes || 0)
        : null,
      total_rounds: isHyrox && form.format_mode === 'rounds'
        ? Number(form.total_rounds || 1)
        : 1,
      use_standard_hyrox: isHyrox ? !!form.use_standard_hyrox : false,
      available_divisions: JSON.stringify(form.available_divisions || []),
      base_strength: Number(form.base_strength || 5),
      base_endurance: Number(form.base_endurance || 5),
      max_participants: form.max_participants === '' ? null : Number(form.max_participants || 0),
      price_fee: fee,
      // Keep legacy fee fields for compatibility
      price_open: fee,
      price_doubles: fee,
      price_relay: fee,
      detail_blocks: JSON.stringify(this.data.detailBlocks || []),
      organizer_id: this.data.openid,
    };

    wx.showLoading({ title: '保存中...' });
    try {
      const db = await getApp().globalData.getDB();

      if (this.data.editingId) {
        await db.from('events').update(payload).eq('id', this.data.editingId);
        await this.saveStations(this.data.editingId);
        wx.hideLoading();
        wx.showToast({ title: '已更新', icon: 'success' });
      } else {
        payload._openid = this.data.openid;
        const { data: newEvent, error } = await db
          .from('events')
          .insert(payload)
          .select()
          .single();

        if (error) {
          wx.hideLoading();
          console.error('Create event failed', error);
          wx.showToast({ title: '创建失败', icon: 'none' });
          return;
        }

        if (newEvent && newEvent.id) {
          await this.saveStations(newEvent.id);
        }

        wx.hideLoading();
        wx.showToast({ title: '已发布', icon: 'success' });
      }

      this.resetForm();
      this.loadEvents();
    } catch (err) {
      wx.hideLoading();
      console.error('Save event failed', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // ========== Station Management ==========

  handleStationInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`stationForm.${field}`]: e.detail.value });
  },

  handleTargetTypeChange(e) {
    const index = Number(e.detail.value);
    const type = this.data.targetTypeOptions[index];
    const unitMap = { distance: '米', reps: '次', time: '秒', calories: '卡' };
    this.setData({
      targetTypeIndex: index,
      'stationForm.target_type': type,
      'stationForm.target_unit': unitMap[type] || '',
    });
  },

  handleStationNameChange(e) {
    const index = Number(e.detail.value);
    const name = this.data.stationNameOptions[index];
    this.setData({
      stationNameIndex: index,
      'stationForm.station_name': name,
      'stationForm.custom_station_name': '',
    });
  },

  quickAddStationPreset(e) {
    const index = Number(e.currentTarget.dataset.index);
    const preset = this.data.stationPresets[index];
    if (!preset) return;

    const station = {
      station_order: this.data.stations.length + 1,
      station_name: preset.station_name,
      station_description: '',
      target_type: preset.target_type,
      target_value: preset.target_value,
      target_unit: preset.target_unit,
      weight_male_kg: null,
      weight_female_kg: null,
      weight_note: '',
      equipment_note: '',
      rest_after_seconds: 0,
    };

    this.setData({ stations: [...this.data.stations, station] });
  },

  addStation() {
    const form = this.data.stationForm;
    const isHyrox = this.data.form.event_template === 'hyrox_official';
    let stationName = form.station_name;
    if (stationName === '自定义') {
      stationName = form.custom_station_name;
    }

    if (!stationName || !stationName.trim()) {
      wx.showToast({ title: '请填写站点名称', icon: 'none' });
      return;
    }
    if (!form.target_value) {
      wx.showToast({ title: '请填写目标值', icon: 'none' });
      return;
    }

    const station = {
      station_order: this.data.stations.length + 1,
      station_name: stationName.trim(),
      station_description: form.station_description || '',
      target_type: form.target_type,
      target_value: Number(form.target_value),
      target_unit: form.target_unit || '',
      weight_male_kg: isHyrox && form.weight_male_kg !== '' ? Number(form.weight_male_kg) : null,
      weight_female_kg: isHyrox && form.weight_female_kg !== '' ? Number(form.weight_female_kg) : null,
      weight_note: isHyrox ? (form.weight_note || '') : '',
      equipment_note: isHyrox ? (form.equipment_note || '') : '',
      rest_after_seconds: isHyrox ? Number(form.rest_after_seconds || 0) : 0,
    };

    this.setData({
      stations: [...this.data.stations, station],
      stationForm: defaultStationForm(),
      targetTypeIndex: 0,
      stationNameIndex: 0,
    });
  },

  removeStation(e) {
    const index = Number(e.currentTarget.dataset.index);
    const stations = this.data.stations.filter((_, i) => i !== index);
    stations.forEach((item, i) => {
      item.station_order = i + 1;
    });
    this.setData({ stations });
  },

  moveStationUp(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index <= 0) return;
    const stations = [...this.data.stations];
    [stations[index - 1], stations[index]] = [stations[index], stations[index - 1]];
    stations.forEach((item, i) => { item.station_order = i + 1; });
    this.setData({ stations });
  },

  moveStationDown(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index >= this.data.stations.length - 1) return;
    const stations = [...this.data.stations];
    [stations[index], stations[index + 1]] = [stations[index + 1], stations[index]];
    stations.forEach((item, i) => { item.station_order = i + 1; });
    this.setData({ stations });
  },

  async saveStations(eventId) {
    if (!eventId) return;

    const db = await getApp().globalData.getDB();
    await db.from('event_stations').delete().eq('event_id', eventId);

    for (const station of this.data.stations) {
      await db.from('event_stations').insert({
        _openid: this.data.openid,
        event_id: eventId,
        station_order: station.station_order,
        station_name: station.station_name,
        station_description: station.station_description || '',
        target_type: station.target_type,
        target_value: safeNumber(station.target_value, 0),
        target_unit: station.target_unit || '',
        weight_male_kg: station.weight_male_kg === null ? null : safeNumber(station.weight_male_kg, null),
        weight_female_kg: station.weight_female_kg === null ? null : safeNumber(station.weight_female_kg, null),
        weight_note: station.weight_note || '',
        equipment_note: station.equipment_note || '',
        rest_after_seconds: safeNumber(station.rest_after_seconds, 0),
      });
    }
  },

  // ========== Detail Blocks ==========

  handleDetailInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [`detailForm.${field}`]: e.detail.value });
  },

  addDetailBlock() {
    const form = this.data.detailForm;
    const block = {
      title: (form.title || '').trim(),
      content: (form.content || '').trim(),
      image_url: form.image_url || '',
    };

    if (!block.title && !block.content && !block.image_url) {
      wx.showToast({ title: '请填写详情内容', icon: 'none' });
      return;
    }

    this.setData({
      detailBlocks: [...this.data.detailBlocks, block],
      detailForm: defaultDetailForm(),
    });
  },

  removeDetailBlock(e) {
    const index = Number(e.currentTarget.dataset.index);
    const detailBlocks = this.data.detailBlocks.filter((_, i) => i !== index);
    this.setData({ detailBlocks });
  },

  moveDetailUp(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index <= 0) return;
    const detailBlocks = [...this.data.detailBlocks];
    [detailBlocks[index - 1], detailBlocks[index]] = [detailBlocks[index], detailBlocks[index - 1]];
    this.setData({ detailBlocks });
  },

  moveDetailDown(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (index >= this.data.detailBlocks.length - 1) return;
    const detailBlocks = [...this.data.detailBlocks];
    [detailBlocks[index], detailBlocks[index + 1]] = [detailBlocks[index + 1], detailBlocks[index]];
    this.setData({ detailBlocks });
  },

  // ========== Image Upload ==========

  async chooseCoverImage() {
    await this.chooseAndUploadImage('cover_url', 'form');
  },

  async chooseDetailImage() {
    await this.chooseAndUploadImage('image_url', 'detailForm');
  },

  async chooseAndUploadImage(field, targetKey) {
    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
      });
      if (!res.tempFiles || res.tempFiles.length === 0) return;

      const tempFilePath = res.tempFiles[0].tempFilePath;
      wx.showLoading({ title: '上传中...' });

      const ext = tempFilePath.split('.').pop() || 'jpg';
      const cloudPath = `events/${field}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath,
      });

      if (!uploadRes.fileID) {
        wx.hideLoading();
        wx.showToast({ title: '上传失败', icon: 'none' });
        return;
      }

      this.setData({ [`${targetKey}.${field}`]: uploadRes.fileID });
      wx.hideLoading();
      wx.showToast({ title: '上传成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('Image upload failed', err);
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
  },
});
