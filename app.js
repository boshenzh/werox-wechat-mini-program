App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('wx.cloud is not available. Please enable CloudBase in the project.');
      return;
    }

    wx.cloud.init({
      env: 'werox-mini-program-8die4bd982524',
      traceUser: true,
    });
  },
  globalData: {},
});
