const { init } = require('@cloudbase/wx-cloud-client-sdk');

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

    this.globalData.cloudEnv = 'werox-mini-program-8die4bd982524';
    this.globalData.backendServiceName = 'werox-bff';

    // Initialize rdb client for SQL database access
    let db = null;
    this.globalData.getDB = async () => {
      if (!db) {
        db = init(wx.cloud).rdb();
      }
      return db;
    };
  },
  globalData: {},
});
